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
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { sendOpsAlert } from '@/lib/ops/alert-email'
import { filterChatMembers, notifyUsers } from '@/lib/workspace-notifications'
import { probeSocialAccountToken } from '@/lib/social-account-token-health'
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
  lineDownReason,
  silenceShouldAlert,
  SILENCE_FLOOR_MINUTES,
  type LineDownReason,
} from '@/lib/channel-silence-core'

export * from '@/lib/channel-silence-core'

const WEEK_MS = 7 * 24 * 60 * 60_000
/** Ambiguous AI sends (SOFT_AI_OUTBOUND_AMBIGUOUS) on one line within this window = suspect. */
const AMBIGUOUS_WINDOW_MS = 2 * 60 * 60_000
const AMBIGUOUS_MIN = 2
/** A line probed this recently is not probed again for ambiguous sends. */
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
  markedToken: number
  cleared: number
  announced: number
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
        reason === 'silent'
          ? `Sin mensajes recientes: ${emailSafeText(label, 60)}`
          : `Perdió el acceso: ${emailSafeText(label, 60)}`,
      lines: [
        `Negocio: ${emailSafeText(tenant?.name, 60)} (${row.tenantId})`,
        `Línea: ${emailSafeText(label, 60)} (${row.platform})`,
        reason === 'silent'
          ? `No llegan mensajes desde ${since.toISOString()}. Puede ser un período tranquilo, no necesariamente una desconexión.`
          : `El token dejó de funcionar (${row.lastErrorCode || row.tokenStatus || 'error'}) a las ${since.toISOString()}.`,
        `Arreglo: ${lineDownFixText(row.platform)}`,
      ],
    })
  }
  return created > 0
}

export async function runChannelSilenceCheck(now = new Date()): Promise<SilenceRunSummary> {
  const summary: SilenceRunSummary = { checked: 0, probed: 0, markedSilent: 0, markedToken: 0, cleared: 0, announced: 0 }
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

  for (const row of rows) {
    // Recovered: a webhook arrived after the silence was flagged.
    if (row.lastErrorCode === SILENT_LINE_CODE) {
      if (row.lastWebhookAt && row.lastErrorAt && row.lastWebhookAt > row.lastErrorAt) {
        await prisma.socialAccount.updateMany({
          where: { id: row.id, tenantId: row.tenantId, lastErrorCode: SILENT_LINE_CODE },
          data: { lastErrorCode: null, lastErrorAt: null },
        })
        Object.assign(row, { lastErrorCode: null, lastErrorAt: null }) // not re-announced below
        summary.cleared += 1
      }
      continue
    }
    if (lineDownReason(row)) continue // already down (token): announced below

    if (ambiguousIds.has(row.id) && !(row.tokenLastCheckedAt && now.getTime() - row.tokenLastCheckedAt.getTime() < REPROBE_MS)) {
      suspects.push({ row, why: 'send_failed' })
      continue
    }
    if (!businessNow) continue
    // A reconnect / re-subscribe restarts the clock (lastWebhookAt still holds the pre-outage time).
    const lastIn = latestOf(row.lastWebhookAt, row.subscribedAt, row.linkedAt)
    const quietMinutes = businessMinutesBetween(lastIn, now)
    if (quietMinutes < SILENCE_FLOOR_MINUTES) continue // cheap filter before counting
    if (silenceShouldAlert(await inboundLastWeek(row, now), quietMinutes)) suspects.push({ row, why: 'silent' })
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
      const data = { tokenLastCheckedAt: now, lastErrorCode: SILENT_LINE_CODE, lastErrorAt: now }
      const res = await prisma.socialAccount.updateMany({ where: probedWhere, data })
      if (res.count > 0) {
        Object.assign(row, data)
        summary.markedSilent += 1
      }
    } else {
      await prisma.socialAccount.updateMany({ where: probedWhere, data: { tokenLastCheckedAt: now } })
    }
  }

  // Announce fresh incidents from any path (this cron, the send route's 190, the daily probe, a connect).
  for (const row of rows) {
    const reason = lineDownReason(row)
    if (!reason || !row.lastErrorAt || now.getTime() - row.lastErrorAt.getTime() > ANNOUNCE_WINDOW_MS) continue
    const since = reason === 'silent' ? row.lastWebhookAt ?? row.lastErrorAt : row.lastErrorAt
    if (await announce(row, reason, since).catch(() => false)) summary.announced += 1
  }
  return summary
}
