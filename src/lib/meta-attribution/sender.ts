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
  type CapiEvent,
} from '@/lib/meta-attribution/capi-payload'
import { ATTRIBUTION_WINDOW_DAYS } from '@/lib/meta-attribution/payment'

/**
 * Sends queued Purchase events to each business's own Meta dataset.
 * HARD no-op unless META_SALES_CAPI_SENDER=1 (Cloudflare only — never on the Railway preview,
 * which shares the production database) AND the business still has the feature on AND the line's
 * dataset is `ready`. Claims rows with a lease (FOR UPDATE SKIP LOCKED) so overlapping runs never
 * send twice; Meta also dedupes by event_id. The click id is read from ChatAdReferral at send time.
 */
const LEASE_MS = 2 * 60_000
const MAX_PER_RUN = 200
const BATCH = 50
const SEND_TIMEOUT_MS = 15_000

type Claimed = {
  id: string
  tenantId: string
  socialAccountId: string
  referralId: string | null
  eventId: string
  eventTime: Date
  value: string | null
  currency: string | null
  attempts: number
  leaseToken: string
}

export type SendResult = { claimed: number; sent: number; retried: number; failed: number; expired: number; skipped: number; disabled?: string }

export async function sendPendingEvents(opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<SendResult> {
  const result: SendResult = { claimed: 0, sent: 0, retried: 0, failed: 0, expired: 0, skipped: 0 }
  if (!senderSwitchOn()) return { ...result, disabled: 'sender_switch_off' }
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? new Date()
  const leaseToken = randomUUID()
  const leaseUntil = new Date(now.getTime() + LEASE_MS)

  let rows: Claimed[]
  try {
    rows = await prisma.$queryRaw<Claimed[]>`
      WITH candidate AS (
        SELECT e."id" FROM public."MetaConversionEvent" e
        WHERE (e."status" = 'pending' AND e."availableAt" <= ${now})
           OR (e."status" = 'processing' AND e."leaseExpiresAt" < ${now})
        ORDER BY e."availableAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${MAX_PER_RUN}
      )
      UPDATE public."MetaConversionEvent" ev
      SET "status" = 'processing', "attempts" = ev."attempts" + 1, "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseUntil}, "updatedAt" = ${now}
      FROM candidate WHERE ev."id" = candidate."id"
      RETURNING ev."id", ev."tenantId", ev."socialAccountId", ev."referralId", ev."eventId", ev."eventTime",
        ev."value"::text AS "value", ev."currency", ev."attempts", ev."leaseToken"`
  } catch (error) {
    if (isMissingTable(error)) return { ...result, disabled: 'tables_missing' }
    throw error
  }
  result.claimed = rows.length

  const byLine = new Map<string, Claimed[]>()
  for (const r of rows) byLine.set(r.socialAccountId, [...(byLine.get(r.socialAccountId) ?? []), r])

  for (const [socialAccountId, events] of byLine) {
    const tenantId = events[0]!.tenantId
    const settings = await readMetaSalesSettings(tenantId)
    const [dataset, account] = await Promise.all([
      prisma.metaCapiDataset.findUnique({ where: { socialAccountId } }),
      prisma.socialAccount.findFirst({
        where: { id: socialAccountId, tenantId, isActive: true },
        select: { wabaId: true, accessToken: true },
      }),
    ])
    const token = account?.accessToken ? decryptSocialAccessToken(account.accessToken) : null
    if (!settings.enabled || dataset?.status !== 'ready' || !dataset.datasetId || !account?.wabaId || !token) {
      // Not sendable right now (turned off, permission missing, line gone): mark skipped, never retried.
      await finish(events, 'skipped', settings.enabled ? 'line_not_ready' : 'feature_off', now)
      result.skipped += events.length
      continue
    }

    const sendable: Array<{ row: Claimed; event: CapiEvent }> = []
    for (const row of events) {
      const ageDays = (now.getTime() - row.eventTime.getTime()) / 86_400_000
      const referral = row.referralId
        ? await prisma.chatAdReferral.findFirst({ where: { id: row.referralId, tenantId }, select: { ctwaClid: true, occurredAt: true } })
        : null
      const clickAgeDays = referral ? (row.eventTime.getTime() - referral.occurredAt.getTime()) / 86_400_000 : Infinity
      const value = row.value === null ? NaN : Number(row.value)
      if (ageDays > ATTRIBUTION_WINDOW_DAYS || clickAgeDays > ATTRIBUTION_WINDOW_DAYS || !referral?.ctwaClid || !Number.isFinite(value)) {
        await finish([row], 'expired', 'outside_window', now)
        result.expired += 1
        continue
      }
      if (row.currency !== 'CRC' && row.currency !== 'USD') {
        await finish([row], 'skipped', 'currency', now)
        result.skipped += 1
        continue
      }
      sendable.push({
        row,
        event: buildPurchaseEvent({
          eventId: row.eventId,
          eventTime: row.eventTime,
          wabaId: account.wabaId,
          ctwaClid: referral.ctwaClid,
          value,
          currency: row.currency,
        }),
      })
    }

    const testCode = activeTestEventCode(settings, now.getTime())
    for (let i = 0; i < sendable.length; i += BATCH) {
      const batch = sendable.slice(i, i + BATCH)
      const outcome = await postEvents(dataset.datasetId, token, buildEventsBody(batch.map((b) => b.event), testCode), fetchImpl)
      if (outcome.ok) {
        await prisma.metaConversionEvent.updateMany({
          where: { id: { in: batch.map((b) => b.row.id) }, leaseToken },
          data: { status: 'sent', sentAt: now, fbtraceId: outcome.fbtraceId, isTest: Boolean(testCode), leaseToken: null, leaseExpiresAt: null, lastErrorCode: null },
        })
        result.sent += batch.length
        continue
      }
      const action = classifyCapiError(outcome.status, outcome.code)
      const code = outcome.code !== null ? String(outcome.code) : `http_${outcome.status}`
      if (action === 'token_invalid' || action === 'missing_permission') {
        await prisma.metaCapiDataset.update({
          where: { socialAccountId },
          data: { status: action, lastErrorCode: code, lastErrorAt: now },
        })
      }
      for (const b of batch) {
        if (action === 'retry' && b.row.attempts < MAX_SEND_ATTEMPTS) {
          await prisma.metaConversionEvent.updateMany({
            where: { id: b.row.id, leaseToken },
            data: { status: 'pending', availableAt: new Date(now.getTime() + retryDelayMs(b.row.attempts)), leaseToken: null, leaseExpiresAt: null, lastErrorCode: code, lastErrorAt: now },
          })
          result.retried += 1
        } else {
          await finish([b.row], action === 'retry' ? 'failed' : action === 'failed' ? 'failed' : 'skipped', code, now)
          result.failed += 1
        }
      }
    }
  }
  return result
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
    const json = (await res.json().catch(() => ({}))) as { fbtrace_id?: unknown; error?: { code?: unknown; fbtrace_id?: unknown } }
    if (res.ok) return { ok: true, fbtraceId: typeof json.fbtrace_id === 'string' ? json.fbtrace_id.slice(0, 120) : null }
    return { ok: false, status: res.status, code: typeof json.error?.code === 'number' ? json.error.code : null }
  } catch {
    return { ok: false, status: 0, code: null }
  }
}
