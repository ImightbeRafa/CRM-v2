/**
 * Outbox dispatcher (SPEC §5): pushes SupportTicketEvent rows to the support
 * agent webhook and sends the notification emails, with retries.
 *
 * - Runs only in the Cloudflare production container (BACKUP_WRITER=1, APP_ENV production/unset): Railway
 *   preview shares the prod DB, so it must never send real mail or webhooks. Local tests
 *   opt in with SUPPORT_DISPATCH_ALLOW_NON_PROD=1.
 * - Claims rows with one UPDATE … FOR UPDATE SKIP LOCKED that pushes `nextAttemptAt` 2 min out
 *   (the lease), so the cron and an after() call never send the same event twice at once.
 * - Webhook and email legs retry independently: 1m, 5m, 30m, 2h, 12h, then `failed`.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isProductionContainer } from '@/lib/ops/runtime'
import { supportPipelineEnabled, supportWebhookUrl } from './config'
import {
  SUPPORT_MAX_ATTEMPTS,
  nextAttemptAfter,
  parseWebhookEvents,
  signPayload,
  type SupportEventPayload,
} from './events'
import { buildCustomerAckEmail, buildNotificationEmail, resendSender, type MailSender } from './notify'
import type { SupportDeliveryStatus } from './types'
import { withReplyToken } from './mcp/reply-token'
import { isOwnSupportAddress } from './spam'

type EnvLike = Record<string, string | undefined>

export function supportDispatchAllowed(env: EnvLike = process.env): boolean {
  if (!supportPipelineEnabled(env)) return false
  if ((env.SUPPORT_DISPATCH_ALLOW_NON_PROD || '').trim() === '1') return true
  const appEnv = (env.APP_ENV || '').trim().toLowerCase()
  if (appEnv && appEnv !== 'production') return false
  // Only the Cloudflare production container (the Worker sets BACKUP_WRITER=1); Railway preview never sends.
  return isProductionContainer(env)
}

export type ClaimedEvent = {
  id: string
  ticketId: string
  type: string
  payload: SupportEventPayload
  webhookStatus: SupportDeliveryStatus
  emailStatus: SupportDeliveryStatus
  attempts: number
}

export type LegResult = { status: SupportDeliveryStatus; error?: string }

/** Pure: the row update after one attempt of both legs. */
export function settleEvent(
  ev: Pick<ClaimedEvent, 'attempts'>,
  webhook: LegResult,
  email: LegResult,
  now: Date = new Date(),
): { webhookStatus: SupportDeliveryStatus; emailStatus: SupportDeliveryStatus; nextAttemptAt: Date; lastError: string | null } {
  const giveUp = ev.attempts >= SUPPORT_MAX_ATTEMPTS
  const fix = (r: LegResult): SupportDeliveryStatus =>
    r.status === 'failed' ? (giveUp ? 'failed' : 'pending') : r.status
  const webhookStatus = fix(webhook)
  const emailStatus = fix(email)
  const errors = [webhook.error && `webhook: ${webhook.error}`, email.error && `email: ${email.error}`].filter(Boolean)
  const next = nextAttemptAfter(ev.attempts, now)
  return {
    webhookStatus,
    emailStatus,
    nextAttemptAt: next ?? now,
    lastError: errors.length ? errors.join(' | ').slice(0, 500) : null,
  }
}

export async function postWebhook(
  payload: SupportEventPayload,
  opts: { url: string; secret: string; fetchImpl?: typeof fetch; now?: Date },
): Promise<LegResult> {
  const body = JSON.stringify(payload)
  const ts = String(Math.floor((opts.now ?? new Date()).getTime() / 1000))
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Betsy-Support/1',
    'X-Betsy-Delivery': payload.betsy.delivery_id,
    'X-Betsy-Timestamp': ts,
  }
  if (opts.secret) {
    headers.Authorization = `Bearer ${opts.secret}`
    headers['X-Betsy-Signature'] = signPayload(opts.secret, ts, body)
  }
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (res.status >= 200 && res.status < 300) return { status: 'sent' }
    return { status: 'failed', error: `http_${res.status}` }
  } catch (error) {
    const name = (error as Error)?.name || 'error'
    return { status: 'failed', error: name === 'TimeoutError' ? 'timeout' : name.slice(0, 60) }
  }
}

async function claimEvents(limit: number): Promise<ClaimedEvent[]> {
  // Timestamps are UTC "timestamp without time zone" (Prisma convention).
  return prisma.$queryRaw<ClaimedEvent[]>`
    UPDATE public."SupportTicketEvent" e
       SET "nextAttemptAt" = (now() AT TIME ZONE 'UTC') + interval '2 minutes',
           "attempts" = e."attempts" + 1
     WHERE e."id" IN (
       SELECT "id" FROM public."SupportTicketEvent"
        WHERE ("webhookStatus" = 'pending' OR "emailStatus" = 'pending')
          AND "nextAttemptAt" <= (now() AT TIME ZONE 'UTC')
        ORDER BY "nextAttemptAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING e."id", e."ticketId", e."type", e."payload", e."webhookStatus", e."emailStatus", e."attempts"`
}

/** A mail send that never hangs the dispatcher (a timed-out send counts as failed and is retried). */
export function withMailTimeout(send: MailSender, ms: number): MailSender {
  return (msg) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: 'mail_timeout' }), ms)
      send(msg)
        .then(resolve, () => resolve({ ok: false, error: 'mail_throw' }))
        .finally(() => clearTimeout(timer))
    })
}

export type DispatchSummary = {
  status: 'ok' | 'disabled' | 'tables_missing'
  claimed: number
  webhookSent: number
  emailSent: number
  failed: number
}

export async function dispatchPendingSupportEvents(
  opts: { limit?: number; budgetMs?: number; env?: EnvLike; fetchImpl?: typeof fetch; send?: MailSender } = {},
): Promise<DispatchSummary> {
  const env = opts.env ?? process.env
  const summary: DispatchSummary = { status: 'ok', claimed: 0, webhookSent: 0, emailSent: 0, failed: 0 }
  if (!supportDispatchAllowed(env)) return { ...summary, status: 'disabled' }
  const send = withMailTimeout(opts.send ?? resendSender, 10_000)
  const url = supportWebhookUrl(env)
  const secret = (env.SUPPORT_WEBHOOK_SECRET || '').trim()
  const pushed = parseWebhookEvents(env.SUPPORT_WEBHOOK_EVENTS)
  let events: ClaimedEvent[]
  try {
    events = await claimEvents(Math.min(Math.max(opts.limit ?? 10, 1), 50))
  } catch (error) {
    if (isMissingRelation(error)) return { ...summary, status: 'tables_missing' }
    throw error
  }
  summary.claimed = events.length
  const started = Date.now()

  for (const ev of events) {
    // Stay well inside the 2-minute claim: worst case per event is ~28 s (8 s webhook + 2 × 10 s mail),
    // so 45 s + 28 s < 120 s. Unprocessed claims simply become due again when the claim lapses.
    if (Date.now() - started > (opts.budgetMs ?? 45_000)) break
    const delivered = withReplyToken(ev.payload, env.NEXTAUTH_SECRET)
    let webhook: LegResult = { status: ev.webhookStatus }
    if (ev.webhookStatus === 'pending') {
      webhook = !url || !pushed.has(ev.type)
        ? { status: 'skipped' }
        : await postWebhook(delivered, { url, secret, fetchImpl: opts.fetchImpl })
    }
    let email: LegResult = { status: ev.emailStatus }
    if (ev.emailStatus === 'pending') {
      const res = await send(buildNotificationEmail(delivered, env))
      email = res.ok ? { status: 'sent' } : { status: 'failed', error: res.error }
      // Customer ack: once, best effort, only on the first try of a new ticket.
      if (res.ok && ev.type === 'ticket.created' && ev.attempts === 1) {
        const t = await prisma.supportTicket
          .findUnique({ where: { id: ev.ticketId }, select: { contactEmail: true, status: true } })
          .catch(() => null)
        if (t && t.status !== 'spam' && !isOwnSupportAddress(t.contactEmail, env)) await send(buildCustomerAckEmail(t.contactEmail, ev.payload.betsy.ref, env))
      }
    }
    if (webhook.status === 'sent') summary.webhookSent++
    if (email.status === 'sent') summary.emailSent++
    const settled = settleEvent(ev, webhook, email)
    if (settled.webhookStatus === 'failed' || settled.emailStatus === 'failed') summary.failed++
    try {
      await prisma.supportTicketEvent.update({ where: { id: ev.id }, data: settled })
    } catch (error) {
      // Keep going: this row re-sends after its claim lapses (at-least-once; the agent dedupes on delivery_id).
      console.error('[support-dispatch] settle failed', ev.id, (error as Error)?.name)
    }
  }
  return summary
}

/** Super-admin "retry": puts a failed leg back to pending, due now. */
export async function retrySupportEvent(eventId: string) {
  const ev = await prisma.supportTicketEvent.findUnique({ where: { id: eventId } })
  if (!ev) return null
  await prisma.supportTicketEvent.update({
    where: { id: eventId },
    data: {
      webhookStatus: ev.webhookStatus === 'failed' ? 'pending' : ev.webhookStatus,
      emailStatus: ev.emailStatus === 'failed' ? 'pending' : ev.emailStatus,
      attempts: 0,
      nextAttemptAt: new Date(),
    },
  })
  return { ok: true as const }
}
