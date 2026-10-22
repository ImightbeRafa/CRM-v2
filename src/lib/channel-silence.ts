/**
 * Dead-line alarm (2026-10-18): a WhatsApp / Instagram line that normally gets traffic and suddenly
 * stops (no webhooks, or sends failing with a token / permission error) is flagged within minutes,
 * not at the next daily token check. Trigger: @patchhouse.cr went silent for ~8 h after a Facebook
 * Login for another page dropped it from the page picker.
 *
 * - Pure helpers (thresholds, business minutes, reason) are unit-tested; the runner is cron-only.
 * - Reads only SocialAccount / ChatMessage counts / ambiguous automation jobs; probes the token of a
 *   SUSPECT line only (one Graph call), never on the webhook path. No token leaves the server.
 * - Silence marker: lastErrorCode 'silent_line' + lastErrorAt (incident start). Cleared by this cron
 *   as soon as a webhook arrives after it.
 * - 2026-10-22 (Rafael: "Sin mensajes recientes" email for a line that was fine): silence alone never
 *   emails, bells or shows a red banner. A quiet busy line is checked (token + webhook subscription);
 *   only real evidence alerts (token dead → 'token', subscription gone → 'webhook_unsubscribed').
 *   Silence far beyond the line's own pattern with both checks fine = a quiet note in the inbox only.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { sendOpsAlert } from '@/lib/ops/alert-email'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'
import { probeSocialAccountToken } from '@/lib/social-account-token-health'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { addAppSecretProofToUrl, buildMetaGraphUrl, getMetaWhatsAppAppId } from '@/lib/meta-api'
import {
  latestOf,
  emailSafeText,
  MIN_WEEKLY_CHATS,
  MIN_WEEKLY_INBOUND,
  lineDownFixText,
  SILENT_LINE_CODE,
  businessMinutesBetween,
  inBusinessHours,
  lineDownLabel,
  lineDownAlerts,
  lineDownReason,
  silenceIsFarBeyondPattern,
  silenceShouldAlert,
  SILENCE_FLOOR_MINUTES,
  WEBHOOK_GONE_CODE,
  WEBHOOK_GONE_FIX_TEXT,
  webhookSubscriptionState,
  type LineDownReason,
} from '@/lib/channel-silence-core'

export * from '@/lib/channel-silence-core'

const WEEK_MS = 7 * 24 * 60 * 60_000
/** Ambiguous AI sends (SOFT_AI_OUTBOUND_AMBIGUOUS) on one line within this window = suspect. */
const AMBIGUOUS_WINDOW_MS = 2 * 60 * 60_000
const AMBIGUOUS_MIN = 2
/** A line probed this recently is not probed again (ambiguous sends, a quiet line, an open marker). */
const REPROBE_MS = 30 * 60_000
/** A line-down incident newer than this is announced (any path may have flipped it). */
const ANNOUNCE_WINDOW_MS = 15 * 60_000
const MAX_PROBES_PER_RUN = 20

type Row = {
  id: string
  tenantId: string
  platform: string
  accountId: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: Date | null
  tokenStatus: string | null
  tokenLastCheckedAt: Date | null
  lastWebhookAt: Date | null
  lastErrorCode: string | null
  lastErrorAt: Date | null
  linkedAt: Date
  displayName: string | null
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  subscribedAt: Date | null
}

export type SilenceRunSummary = {
  checked: number
  probed: number
  markedSilent: number
  markedWebhook: number
  markedToken: number
  cleared: number
  announced: number
}

/**
 * Is Betsy's app still subscribed to this line's webhooks? One read-only Graph call; any error or
 * odd answer is 'unknown' (never an alert). The token never leaves this function.
 */
async function webhookSubscription(row: Row): Promise<'subscribed' | 'missing' | 'unknown'> {
  const token = decryptSocialAccessToken(row.accessToken)
  if (!token) return 'unknown'
  const meta = parseSocialRefreshToken(row.refreshToken)
  const target = row.platform === 'whatsapp' ? meta.whatsappBusinessAccountId : meta.pageId
  if (!target) return 'unknown'
  try {
    const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${encodeURIComponent(target)}/subscribed_apps`), token, {
      purpose: row.platform === 'whatsapp' ? 'whatsapp' : 'default',
    })
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return 'unknown'
    const data = await res.json().catch(() => null)
    const appId = row.platform === 'whatsapp' ? getMetaWhatsAppAppId() : process.env.META_APP_ID
    return webhookSubscriptionState(data, { appId, platform: row.platform })
  } catch {
    return 'unknown'
  }
}

/** Inbound messages last week, or 0 when they came from too few chats (one stranger can't make a line "busy"). */
async function inboundLastWeek(row: Row, now: Date): Promise<number> {
  const where = {
    tenantId: row.tenantId,
    socialAccountId: row.id,
    direction: 'inbound',
    sentAt: { gte: new Date(now.getTime() - WEEK_MS) },
  }
  const count = await prisma.chatMessage.count({ where })
  if (count < MIN_WEEKLY_INBOUND) return count
  const chats = await prisma.chatMessage.groupBy({
    by: ['conversationId'],
    where: { ...where, conversationId: { not: null } },
    orderBy: { conversationId: 'asc' },
    take: MIN_WEEKLY_CHATS,
  })
  return chats.length >= MIN_WEEKLY_CHATS ? count : 0
}

async function announce(row: Row, reason: LineDownReason, since: Date): Promise<boolean> {
  const label = lineDownLabel(row)
  const sinceKey = Math.floor(since.getTime() / 60_000)
  const members = await prisma.membership.findMany({
    where: { tenantId: row.tenantId, isActive: true, user: { active: true } },
    select: { userId: true },
    take: 50,
  })
  const userIds = (await filterChatMembers(row.tenantId, members.map((m) => m.userId))).slice(0, 20)
  // Kind 'ai_no_reply' is already allowed by SQL 049; the `line_down:` prefix tells it apart.
  const created = userIds.length
    ? await notifyUsers({
        tenantId: row.tenantId,
        actorUserId: null,
        kind: 'ai_no_reply',
        userIds,
        dedupeKey: () => `line_down:${row.id}:${reason}:${sinceKey}`,
      }).catch(() => 0)
    : 0
  // Email once per incident: when the bell rows were actually inserted (the DB unique key is the
  // dedupe across runs and containers), or when the business has no chat members to bell.
  if (created > 0 || userIds.length === 0) {
    const tenant = await prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { name: true } }).catch(() => null)
    await sendOpsAlert({
      key: `line-down:${row.id}:${sinceKey}`,
      // Business / line names are tenant-chosen text: no URLs, plain characters, short.
      subject:
        reason === 'webhook'
          ? `Dejó de recibir mensajes: ${emailSafeText(label, 60)}`
          : `Perdió el acceso: ${emailSafeText(label, 60)}`,
      lines: [
        `Negocio: ${emailSafeText(tenant?.name, 60)} (${row.tenantId})`,
        `Línea: ${emailSafeText(label, 60)} (${row.platform})`,
        reason === 'webhook'
          ? `Meta dejó de mandar a Betsy los mensajes de esta línea (la suscripción del webhook ya no está). Último mensaje: ${since.toISOString()}.`
          : `El token dejó de funcionar (${row.lastErrorCode || row.tokenStatus || 'error'}) a las ${since.toISOString()}.`,
        `Arreglo: ${reason === 'webhook' ? WEBHOOK_GONE_FIX_TEXT : lineDownFixText(row.platform)}`,
      ],
    })
  }
  return created > 0
}

export async function runChannelSilenceCheck(now = new Date()): Promise<SilenceRunSummary> {
  const summary: SilenceRunSummary = {
    checked: 0,
    probed: 0,
    markedSilent: 0,
    markedWebhook: 0,
    markedToken: 0,
    cleared: 0,
    announced: 0,
  }
  const rows: Row[] = await prisma.socialAccount.findMany({
    where: { isActive: true, disconnectedAt: null, platform: { in: ['whatsapp', 'instagram'] } },
    select: {
      id: true, tenantId: true, platform: true, accountId: true, accessToken: true, refreshToken: true,
      expiresAt: true, tokenStatus: true, tokenLastCheckedAt: true, lastWebhookAt: true, lastErrorCode: true,
      lastErrorAt: true, linkedAt: true, displayName: true, providerDisplayName: true, providerUsername: true,
      displayPhoneNumber: true, subscribedAt: true,
    },
    orderBy: { linkedAt: 'asc' },
    take: 500,
  })
  summary.checked = rows.length

  // Lines with a cluster of ambiguous AI sends (the AI could not confirm delivery).
  const ambiguous = await prisma.chatAutomationJob.groupBy({
    by: ['socialAccountId'],
    where: { status: 'ambiguous', failedAt: { gte: new Date(now.getTime() - AMBIGUOUS_WINDOW_MS) } },
    _count: { _all: true },
  })
  const ambiguousIds = new Set(ambiguous.filter((a) => a._count._all >= AMBIGUOUS_MIN).map((a) => a.socialAccountId))

  const businessNow = inBusinessHours(now)
  const suspects: Array<{ row: Row; why: 'silent' | 'send_failed' }> = []

  const quietByRow = new Map<string, { inbound7d: number; quietMinutes: number }>()
  for (const row of rows) {
    const marker = row.lastErrorCode === SILENT_LINE_CODE || row.lastErrorCode === WEBHOOK_GONE_CODE
    // Recovered: a webhook arrived after the silence / missing subscription was flagged.
    if (marker) {
      if (row.lastWebhookAt && row.lastErrorAt && row.lastWebhookAt > row.lastErrorAt) {
        await prisma.socialAccount.updateMany({
          where: { id: row.id, tenantId: row.tenantId, lastErrorCode: row.lastErrorCode },
          data: { lastErrorCode: null, lastErrorAt: null },
        })
        Object.assign(row, { lastErrorCode: null, lastErrorAt: null }) // not re-announced below
        summary.cleared += 1
        continue
      }
    } else if (lineDownReason(row)) {
      continue // already down (token): announced below
    }
    const probedRecently = Boolean(row.tokenLastCheckedAt && now.getTime() - row.tokenLastCheckedAt.getTime() < REPROBE_MS)

    if (!marker && ambiguousIds.has(row.id) && !probedRecently) {
      suspects.push({ row, why: 'send_failed' })
      continue
    }
    if (!businessNow || probedRecently) continue
    // A reconnect / re-subscribe restarts the clock (lastWebhookAt still holds the pre-outage time).
    const lastIn = latestOf(row.lastWebhookAt, row.subscribedAt, row.linkedAt)
    const quietMinutes = businessMinutesBetween(lastIn, now)
    if (!marker && quietMinutes < SILENCE_FLOOR_MINUTES) continue // cheap filter before counting
    const inbound7d = await inboundLastWeek(row, now)
    // A marked line is re-checked (escalate quiet → webhook gone, or clear a fixed subscription).
    if (marker || silenceShouldAlert(inbound7d, quietMinutes)) {
      quietByRow.set(row.id, { inbound7d, quietMinutes })
      suspects.push({ row, why: 'silent' })
    }
  }

  for (const { row, why } of suspects.slice(0, MAX_PROBES_PER_RUN)) {
    const probe = await probeSocialAccountToken(row)
    summary.probed += 1
    if (probe.transient) continue // Meta hiccup: says nothing, try next run
    // Only while the probed token is still the stored one (a reconnect may have landed during the probe).
    const probedWhere = { id: row.id, tenantId: row.tenantId, accessToken: row.accessToken }
    if (probe.tokenStatus === 'revoked' || probe.tokenStatus === 'expired' || probe.tokenStatus === 'error') {
      const data = { tokenStatus: probe.tokenStatus, tokenLastCheckedAt: now, lastErrorCode: probe.lastErrorCode, lastErrorAt: now }
      const res = await prisma.socialAccount.updateMany({ where: probedWhere, data })
      if (res.count > 0) {
        Object.assign(row, data)
        summary.markedToken += 1
      }
    } else if (why === 'silent') {
      // Token fine: is Meta still sending this line's messages to Betsy?
      const subscription = await webhookSubscription(row)
      const quiet = quietByRow.get(row.id)
      const code =
        subscription === 'missing'
          ? WEBHOOK_GONE_CODE
          : subscription === 'unknown'
            ? row.lastErrorCode // proves nothing: keep what is there
            : quiet && silenceIsFarBeyondPattern(quiet.inbound7d, quiet.quietMinutes)
              ? SILENT_LINE_CODE
              : null
      const keepStart = code != null && code === row.lastErrorCode
      const data = {
        tokenLastCheckedAt: now,
        lastErrorCode: code,
        lastErrorAt: code == null ? null : keepStart ? row.lastErrorAt : now,
      }
      const res = await prisma.socialAccount.updateMany({ where: probedWhere, data })
      if (res.count > 0) {
        Object.assign(row, data)
        if (code === SILENT_LINE_CODE && !keepStart) summary.markedSilent += 1
        if (code === WEBHOOK_GONE_CODE && !keepStart) summary.markedWebhook += 1
      }
    } else {
      await prisma.socialAccount.updateMany({ where: probedWhere, data: { tokenLastCheckedAt: now } })
    }
  }

  // Announce fresh incidents from any path (this cron, the send route's 190, the daily probe, a connect).
  // Real evidence only: a quiet line (silent marker) is shown as a note in the inbox, never announced.
  for (const row of rows) {
    const reason = lineDownReason(row)
    if (!lineDownAlerts(reason) || !reason) continue
    if (!row.lastErrorAt || now.getTime() - row.lastErrorAt.getTime() > ANNOUNCE_WINDOW_MS) continue
    const since = reason === 'webhook' ? row.lastWebhookAt ?? row.lastErrorAt : row.lastErrorAt
    if (await announce(row, reason, since).catch(() => false)) summary.announced += 1
  }
  return summary
}
