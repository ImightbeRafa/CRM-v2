import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'
import { activeTestEventCode, readMetaSalesSettings, senderSwitchOn } from '@/lib/meta-attribution/settings'
import {
  MAX_SEND_ATTEMPTS,
  buildEventsBody,
  buildPurchaseEvent,
  classifyCapiError,
  retryDelayMs,
} from '@/lib/meta-attribution/capi-payload'
import { ATTRIBUTION_WINDOW_DAYS, isPaymentConfirmed } from '@/lib/meta-attribution/payment'

/**
 * Sends queued Purchase events to each business's own Meta dataset.
 * HARD no-op unless META_SALES_CAPI_SENDER=1 (Cloudflare only — never on the Railway preview,
 * which shares the production database) AND the business still has the feature on.
 *
 * Robustness (SecureDog 2026-10-02):
 * - ONE event per request: Meta rejects a whole request for one bad event (a forged click id
 *   must never fail real sales);
 * - a line that is not ready (permission, token) keeps its sales PENDING (retried, 7-day expiry),
 *   never silently dropped; one broken line never blocks the others;
 * - the order is re-read right before sending: still paid, not archived;
 * - test mode sends each sale once as a test event, then for real when the test code expires;
 * - a run stops after ~60 s and releases what it did not send; claims never re-take a row past
 *   the attempt cap.
 */
const LEASE_MS = 5 * 60_000
const RUN_BUDGET_MS = 60_000
const MAX_PER_RUN = 200
const MAX_CLAIM_ATTEMPTS = 20
const SEND_TIMEOUT_MS = 15_000
const LINE_NOT_READY_RETRY_MS = 60 * 60_000

type Claimed = {
  id: string
  tenantId: string
  socialAccountId: string
  orderId: string | null
  referralId: string | null
  eventId: string
  eventTime: Date
  value: string | null
  currency: string | null
  attempts: number
  isTest: boolean
  leaseToken: string
}

export type SendResult = {
  claimed: number
  sent: number
  testSent: number
  retried: number
  failed: number
  expired: number
  skipped: number
  waiting: number
  released: number
  disabled?: string
}

export async function sendPendingEvents(opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<SendResult> {
  const result: SendResult = { claimed: 0, sent: 0, testSent: 0, retried: 0, failed: 0, expired: 0, skipped: 0, waiting: 0, released: 0 }
  if (!senderSwitchOn()) return { ...result, disabled: 'sender_switch_off' }
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const startedAt = Date.now()
  const leaseToken = randomUUID()
  const leaseUntil = new Date(now.getTime() + LEASE_MS)

  let rows: Claimed[]
  try {
    // Rows that were re-claimed too many times (e.g. a crash loop) expire instead of cycling forever.
    await prisma.$executeRaw`
      UPDATE public."MetaConversionEvent" SET "status" = 'expired', "lastErrorCode" = 'too_many_claims', "updatedAt" = ${now},
        "leaseToken" = NULL, "leaseExpiresAt" = NULL
      WHERE "status" IN ('pending', 'processing') AND "attempts" >= ${MAX_CLAIM_ATTEMPTS}`
    rows = await prisma.$queryRaw<Claimed[]>`
      WITH candidate AS (
        SELECT e."id" FROM public."MetaConversionEvent" e
        WHERE ((e."status" = 'pending' AND e."availableAt" <= ${now})
           OR (e."status" = 'processing' AND e."leaseExpiresAt" < ${now}))
          AND e."attempts" < ${MAX_CLAIM_ATTEMPTS}
        ORDER BY e."availableAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${MAX_PER_RUN}
      )
      UPDATE public."MetaConversionEvent" ev
      SET "status" = 'processing', "attempts" = ev."attempts" + 1, "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidate WHERE ev."id" = candidate."id"
      RETURNING ev."id", ev."tenantId", ev."socialAccountId", ev."orderId", ev."referralId", ev."eventId", ev."eventTime",
        ev."value"::text AS "value", ev."currency", ev."attempts", ev."isTest", ev."leaseToken"`
  } catch (error) {
    if (isMissingTable(error)) return { ...result, disabled: 'tables_missing' }
    throw error
  }
  result.claimed = rows.length

  const byLine = new Map<string, Claimed[]>()
  for (const r of rows) {
    const key = `${r.tenantId}:${r.socialAccountId}`
    byLine.set(key, [...(byLine.get(key) ?? []), r])
  }

  const done = new Set<string>()
  for (const events of byLine.values()) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) break
    try {
      await sendLine(events, { now, fetchImpl, leaseToken, result, startedAt, done })
    } catch (error) {
      // One broken line (e.g. a token that cannot be decrypted) never blocks the others.
      console.error('[meta-attribution] line failed', error instanceof Error ? error.name : 'unknown')
      await reschedule(events.filter((e) => !done.has(e.id)), 'line_error', new Date(now.getTime() + LINE_NOT_READY_RETRY_MS), now)
      result.waiting += events.filter((e) => !done.has(e.id)).length
      for (const e of events) done.add(e.id)
    }
  }

  // Out of time: give the rest back right away (no 5-minute lease wait, no double send).
  const leftover = rows.filter((r) => !done.has(r.id))
  if (leftover.length) {
    await prisma.metaConversionEvent.updateMany({
      where: { id: { in: leftover.map((r) => r.id) }, leaseToken },
      data: { status: 'pending', leaseToken: null, leaseExpiresAt: null, attempts: { decrement: 1 } },
    })
    result.released = leftover.length
  }
  return result
}

async function sendLine(
  events: Claimed[],
  ctx: { now: Date; fetchImpl: typeof fetch; leaseToken: string; result: SendResult; startedAt: number; done: Set<string> },
) {
  const { now, fetchImpl, result, done } = ctx
  const { tenantId, socialAccountId } = events[0]!
  const settings = await readMetaSalesSettings(tenantId)
  if (!settings.enabled) {
    await finish(events, 'skipped', 'feature_off', now)
    result.skipped += events.length
    events.forEach((e) => done.add(e.id))
    return
  }
  const [dataset, account] = await Promise.all([
    prisma.metaCapiDataset.findFirst({ where: { socialAccountId, tenantId } }),
    prisma.socialAccount.findFirst({ where: { id: socialAccountId, tenantId, isActive: true }, select: { wabaId: true, accessToken: true } }),
  ])
  let token: string | null = null
  try {
    token = account?.accessToken ? decryptSocialAccessToken(account.accessToken) ?? null : null
  } catch {
    token = null
  }
  const datasetId = dataset?.datasetId && /^\d{5,30}$/.test(dataset.datasetId) ? dataset.datasetId : null
  if (dataset?.status !== 'ready' || !datasetId || !account?.wabaId || !token) {
    // Not sendable right now: keep the sales waiting (7-day expiry still applies).
    await reschedule(events, account ? 'line_not_ready' : 'line_gone', new Date(now.getTime() + LINE_NOT_READY_RETRY_MS), now)
    result.waiting += events.length
    events.forEach((e) => done.add(e.id))
    return
  }

  const testCode = activeTestEventCode(settings, now.getTime())
  for (const row of events) {
    if (Date.now() - ctx.startedAt > RUN_BUDGET_MS) return
    done.add(row.id)
    const ageDays = (now.getTime() - row.eventTime.getTime()) / 86_400_000
    if (ageDays > ATTRIBUTION_WINDOW_DAYS) {
      await finish([row], 'expired', 'outside_window', now)
      result.expired += 1
      continue
    }
    if (row.currency !== 'CRC' && row.currency !== 'USD') {
      await finish([row], 'skipped', 'currency', now)
      result.skipped += 1
      continue
    }
    // Still a paid, active order right now (a retry can come hours later).
    const order = row.orderId
      ? await prisma.order.findFirst({
          where: { id: row.orderId, tenantId },
          select: { status: true, contraEntrega: true, cePaymentConfirmed: true, customFields: true, deletedAt: true },
        })
      : null
    if (!order || !isPaymentConfirmed(order)) {
      await finish([row], 'skipped', 'order_not_paid', now)
      result.skipped += 1
      continue
    }
    const referral = row.referralId
      ? await prisma.chatAdReferral.findFirst({ where: { id: row.referralId, tenantId }, select: { ctwaClid: true, occurredAt: true } })
      : null
    const value = row.value === null ? NaN : Number(row.value)
    if (!referral?.ctwaClid || referral.occurredAt > row.eventTime || !Number.isFinite(value)) {
      await finish([row], 'expired', 'no_click', now)
      result.expired += 1
      continue
    }
    // Test mode: each sale goes once as a test event, then for real after the code expires.
    if (testCode && row.isTest) {
      await reschedule([row], 'test_mode', settings.testEventCodeExpiresAt ? new Date(settings.testEventCodeExpiresAt) : new Date(now.getTime() + 3_600_000), now)
      result.waiting += 1
      continue
    }
    const event = buildPurchaseEvent({ eventId: row.eventId, eventTime: row.eventTime, wabaId: account.wabaId, ctwaClid: referral.ctwaClid, value, currency: row.currency })
    const outcome = await postEvents(datasetId, token, buildEventsBody([event], testCode), fetchImpl)
    if (outcome.ok && testCode) {
      await prisma.metaConversionEvent.updateMany({
        where: { id: row.id, leaseToken: ctx.leaseToken },
        data: {
          status: 'pending',
          isTest: true,
          availableAt: settings.testEventCodeExpiresAt ? new Date(settings.testEventCodeExpiresAt) : now,
          fbtraceId: outcome.fbtraceId,
          leaseToken: null,
          leaseExpiresAt: null,
          attempts: { decrement: 1 },
        },
      })
      result.testSent += 1
      continue
    }
    if (outcome.ok) {
      const updated = await prisma.metaConversionEvent.updateMany({
        where: { id: row.id, leaseToken: ctx.leaseToken },
        data: { status: 'sent', sentAt: now, fbtraceId: outcome.fbtraceId, leaseToken: null, leaseExpiresAt: null, lastErrorCode: null },
      })
      if (updated.count === 0) console.warn('[meta-attribution] lease lost after send', row.eventId.slice(0, 64))
      result.sent += 1
      continue
    }
    const action = classifyCapiError(outcome.status, outcome.code)
    const code = outcome.code !== null ? String(outcome.code) : `http_${outcome.status}`
    if (action === 'token_invalid' || action === 'missing_permission') {
      await prisma.metaCapiDataset.updateMany({ where: { socialAccountId, tenantId }, data: { status: action, lastErrorCode: code, lastErrorAt: now } })
      // The rest of this line waits for the reconnect instead of being dropped.
      const rest = events.filter((e) => !done.has(e.id))
      await reschedule([row, ...rest], action, new Date(now.getTime() + LINE_NOT_READY_RETRY_MS), now)
      result.waiting += 1 + rest.length
      rest.forEach((e) => done.add(e.id))
      return
    }
    if (action === 'retry' && row.attempts < MAX_SEND_ATTEMPTS) {
      await reschedule([row], code, new Date(now.getTime() + retryDelayMs(row.attempts)), now, true)
      result.retried += 1
    } else {
      await finish([row], 'failed', code, now)
      result.failed += 1
    }
  }
}

/** Back to pending. A wait (line not ready, test mode) is not an attempt; a Meta error is. */
async function reschedule(rows: Claimed[], code: string, availableAt: Date, now: Date, countsAsAttempt = false) {
  if (!rows.length) return
  await prisma.metaConversionEvent.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, leaseToken: rows[0]!.leaseToken },
    data: {
      status: 'pending',
      availableAt,
      lastErrorCode: code.slice(0, 120),
      lastErrorAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
      ...(countsAsAttempt ? {} : { attempts: { decrement: 1 } }),
    },
  })
}

async function finish(rows: Claimed[], status: 'sent' | 'skipped' | 'expired' | 'failed', code: string, now: Date) {
  if (!rows.length) return
  await prisma.metaConversionEvent.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, leaseToken: rows[0]!.leaseToken },
    data: { status, lastErrorCode: code.slice(0, 120), lastErrorAt: now, leaseToken: null, leaseExpiresAt: null },
  })
}

async function postEvents(
  datasetId: string,
  token: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; fbtraceId: string | null } | { ok: false; status: number; code: number | null }> {
  try {
    const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${datasetId}/events`), token, { purpose: 'whatsapp' })
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'error',
    })
    const json = (await res.json().catch(() => ({}))) as { fbtrace_id?: unknown; error?: { code?: unknown } }
    if (res.ok) return { ok: true, fbtraceId: typeof json.fbtrace_id === 'string' ? json.fbtrace_id.slice(0, 120) : null }
    return { ok: false, status: res.status, code: typeof json.error?.code === 'number' ? json.error.code : null }
  } catch {
    return { ok: false, status: 0, code: null }
  }
}
