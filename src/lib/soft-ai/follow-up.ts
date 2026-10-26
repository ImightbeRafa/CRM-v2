import 'server-only'
/**
 * Follow-up A/B (Rafael 2026-10-17): one follow-up message to chats where the agent answered and the customer went
 * quiet, split between two texts (A / B) to learn which one closes more. Runs from the chat-automation cron, a few
 * chats per minute, only inside the agent's configured business hours and inside Meta's 24 h reply window.
 *
 * Never (verifier round 1): a second follow-up to the same chat (atomic claim per campaign, re-checked by id), a chat a
 * person took over / paused / closed, a chat past the early "still deciding" stages, a chat with a payment or order
 * alert or a linked order, a chat whose last agent turn handed off or asked a person to look ("Dame un momento…"), a
 * customer who asked to stop or said no, a chat whose last outbound message was written by a person, a line that does
 * not answer right now, an agent without business hours. At most PER_RUN_MAX sends per cron run (shared counter).
 * Campaigns are created / stopped by an audited script and stored in TenantFeatureFlag `agent_follow_up_v1`; a round
 * that runs out on its own is renewed by the cron (renewExpiredCampaigns), so follow-ups never silently stop.
 */
import { createHash, randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { dualWriteChatMessage, isPersistedDualWrite } from '@/lib/chat-conversation-write'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { afterHoursState } from '@/lib/soft-ai/business-hours'
import { isOptOutText } from '@/lib/soft-ai/waiting-ack'
import { lineAnswersNow } from '@/lib/soft-ai/waiting-sweep'
import { loadHoursSetup, sendMetaText } from '@/lib/soft-ai/agent-turn'
import { readOutcomeMarkers } from '@/lib/soft-ai/agent-turn-outcome'
import { ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG } from '@/lib/crm-stages'
import { runPreModelGates } from '@/lib/soft-ai/agent-claim-gates'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'

export const FOLLOW_UP_FLAG = 'agent_follow_up_v1'
/** Meta's window is 24 h after the customer's last message; keep a margin. */
export const FOLLOW_UP_WINDOW_MS = 23 * 60 * 60 * 1000
export const PER_RUN_MAX = 6
export const SILENT_MIN_MINUTES = 30
export const MAX_CAMPAIGN_HOURS = 48
const PAGE = 40
/** Only chats still deciding: no stage yet or an early sales stage (a chat in payment / production / won is never nudged). */
const NUDGE_STATUSES = new Set(['', 'nuevo', 'en_curso', 'nuevo_lead', 'cotizando'])
/** The customer's last word was a no ("no gracias", "no me interesa", "más adelante"). */
const DECLINE_RE = /(?<![\p{L}])(no\s*,?\s*gracias|no\s+me\s+interesa|no\s+por\s+ahora|m[aá]s\s+adelante|ya\s+no|despu[eé]s\s+(?:te|les)\s+(?:escribo|aviso)|lo\s+pienso)(?![\p{L}])/iu

export type FollowUpVariant = 'A' | 'B'
export type FollowUpCampaign = {
  id: string
  agentId: string
  lineIds: string[]
  texts: Record<FollowUpVariant, string>
  createdAt: string
  /** No sends after this time (ISO). */
  until: string
  /** Minimum minutes since the last message before a chat gets its follow-up (≥ SILENT_MIN_MINUTES). */
  silentMinMinutes: number
  active: boolean
  /** conversationId → the variant it got (the claim; a chat is never followed up twice in a campaign). */
  claimed: Record<string, FollowUpVariant | `${FollowUpVariant}!`>
}
export type FollowUpConfig = { campaigns: FollowUpCampaign[] }

/** Deterministic 50/50 split per chat and campaign. Pure. */
export function followUpVariant(campaignId: string, conversationId: string): FollowUpVariant {
  const byte = createHash('sha256').update(`${campaignId}:${conversationId}`).digest()[0]
  return byte % 2 === 0 ? 'A' : 'B'
}

/** Campaigns with both texts, real dates and sane numbers only (anything else is dropped, never "fixed"). */
export function parseFollowUpConfig(raw: unknown): FollowUpConfig {
  const campaigns = Array.isArray((raw as FollowUpConfig | null)?.campaigns) ? (raw as FollowUpConfig).campaigns : []
  return {
    campaigns: campaigns
      .filter(
        (c) =>
          c &&
          typeof c.id === 'string' &&
          typeof c.agentId === 'string' &&
          Array.isArray(c.lineIds) &&
          typeof c.texts?.A === 'string' &&
          typeof c.texts?.B === 'string' &&
          c.texts.A.trim() &&
          c.texts.B.trim() &&
          Number.isFinite(Date.parse(c.createdAt)) &&
          Number.isFinite(Date.parse(c.until)) &&
          Date.parse(c.until) - Date.parse(c.createdAt) <= MAX_CAMPAIGN_HOURS * 3600_000 &&
          Number.isFinite(c.silentMinMinutes) &&
          c.silentMinMinutes >= SILENT_MIN_MINUTES,
      )
      .map((c) => ({ ...c, claimed: c.claimed && typeof c.claimed === 'object' && !Array.isArray(c.claimed) ? c.claimed : {} })),
  }
}

/** Atomic claim, tied to the campaign's own id and an object-typed `claimed` (a hand-edited config can't misfire). */
async function claimChat(flagId: string, index: number, campaignId: string, conversationId: string, value: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TenantFeatureFlag"
    SET "config" = jsonb_set("config", ARRAY['campaigns', ${String(index)}::text, 'claimed', ${conversationId}::text], to_jsonb(${value}::text), true),
        "updatedAt" = now()
    WHERE "id" = ${flagId}
      AND "key" = ${FOLLOW_UP_FLAG}
      AND "config"->'campaigns'->(${index}::int)->>'id' = ${campaignId}::text
      AND "config"->'campaigns'->(${index}::int)->>'active' = 'true'
      AND jsonb_typeof("config"->'campaigns'->(${index}::int)->'claimed') = 'object'
      AND NOT ("config"->'campaigns'->(${index}::int)->'claimed' ? (${conversationId}::text))
    RETURNING "id"`
  return rows.length === 1
}

async function markFailed(flagId: string, index: number, campaignId: string, conversationId: string, variant: FollowUpVariant) {
  await prisma.$executeRaw`
    UPDATE "TenantFeatureFlag"
    SET "config" = jsonb_set("config", ARRAY['campaigns', ${String(index)}::text, 'claimed', ${conversationId}::text], to_jsonb(${`${variant}!`}::text), true)
    WHERE "id" = ${flagId} AND "key" = ${FOLLOW_UP_FLAG}
      AND "config"->'campaigns'->(${index}::int)->>'id' = ${campaignId}::text`
}

/** Why a chat gets no follow-up (null = it can get one). Exported for the report / tests. */
export async function followUpSkipReason(
  tenantId: string,
  conv: { id: string; aiMode: string | null; tags: string[]; status: string | null },
): Promise<string | null> {
  if (conv.aiMode === 'human' || conv.aiMode === 'paused' || conv.aiMode === 'human_takeover') return 'person_or_paused'
  if (!NUDGE_STATUSES.has(conv.status || '')) return 'stage_not_deciding'
  if (conv.tags.includes(PAYMENT_REVIEW_TAG) || conv.tags.includes(ORDER_REVIEW_TAG)) return 'review_alert'
  // Closed by a person, or snoozed (the team chose when to come back).
  const work = await prisma.chatConversationWorkState
    .findFirst({ where: { conversationId: conv.id, tenantId, OR: [{ closedAt: { not: null } }, { snoozedUntil: { gt: new Date() } }] }, select: { conversationId: true } })
    .catch(() => null)
  if (work) return 'closed_or_snoozed'
  const order = await prisma.chatMessage.findFirst({ where: { tenantId, conversationId: conv.id, orderId: { not: null } }, select: { id: true } })
  if (order) return 'has_order'
  // The agent's last turn handed off or asked a person to look ("Dame un momento y te confirmo") → a person owes the reply.
  const lastTurn = await prisma.chatAgentTurn.findFirst({
    where: { tenantId, conversationId: conv.id, testSessionId: null, status: 'delivered' },
    orderBy: { createdAt: 'desc' },
    select: { decisionTrace: true },
  })
  const markers = readOutcomeMarkers(lastTurn?.decisionTrace)
  if (markers?.needsHuman || markers?.handoffKind) return 'waiting_on_person'
  const recent = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId: conv.id },
    orderBy: { sentAt: 'desc' },
    take: 30,
    select: { direction: true, content: true, metadata: true },
  })
  const lastOut = recent.find((m) => m.direction === 'outbound')
  if (!lastOut || (lastOut.metadata as { softAi?: unknown } | null)?.softAi !== true) return 'last_reply_by_person'
  if (recent.some((m) => m.direction === 'inbound' && isOptOutText(m.content))) return 'opted_out'
  const lastIn = recent.find((m) => m.direction === 'inbound')
  if (lastIn && DECLINE_RE.test(lastIn.content || '')) return 'declined'
  if (recent.some((m) => m.direction === 'outbound' && (m.metadata as { followUp?: unknown } | null)?.followUp)) return 'already_followed_up'
  // Verifier (auto-renew): one nudge per chat EVER, not only within its last 30 messages (rounds renew every 48 h).
  if (await followedUpBefore(tenantId, conv.id)) return 'already_followed_up'
  return null
}

/** Any follow-up ever sent in this chat (whatever round). */
export async function followedUpBefore(tenantId: string, conversationId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS "one" FROM "ChatMessage"
     WHERE "tenantId" = ${tenantId} AND "conversationId" = ${conversationId} AND "direction" = 'outbound'
       AND "metadata" ? 'followUp'
     LIMIT 1`
  return rows.length > 0
}

type RawCampaign = Record<string, unknown>
type FlagRow = { id: string; tenantId: string | null; scope: string; config: unknown }

/** Renewal stops (never renews) a round whose text made people ask to stop — same limits as the --rotate winner rule. */
export const OPT_OUT_GUARD = { minCount: 3, maxRate: 0.03 } as const
/** A round that ended longer ago than this is never brought back by the cron (only --start / --rotate open it). */
export const RENEW_MAX_AGE_MS = 7 * 24 * 3600_000

export type RenewOutcome = { from: string; to: string | null; agentId: string; why: 'renewed' | 'opt_out_guard' }

/**
 * Rafael 2026-10-25 ("10/10, sin excepciones"): a round never just ends. When a live agent's NEWEST valid round ran out
 * on its own (still `active`, past `until` by at most RENEW_MAX_AGE_MS, never stopped by hand, opened by the script with
 * text `keys`), the cron opens the same round again for MAX_CAMPAIGN_HOURS: same texts, keys, lines and wait, fresh
 * claims (followedUpBefore still keeps every chat to one nudge, ever). A round whose text broke the opt-out guard is
 * stopped instead (stopReason 'opt_out_guard', audited). A round someone stopped stays stopped; picking a new winner
 * stays with the audited --rotate script. Pure: returns the new array, or null when nothing changes.
 */
export function renewExpiredCampaigns(
  raw: RawCampaign[],
  now: number,
  liveAgentIds: ReadonlySet<string>,
  newId: () => string,
  optOutBlocked: ReadonlySet<string> = new Set(),
): { campaigns: RawCampaign[]; outcomes: RenewOutcome[] } | null {
  const valid = new Set(parseFollowUpConfig({ campaigns: raw }).campaigns.map((c) => c.id))
  const newest = new Map<string, RawCampaign>()
  for (const c of raw) {
    // Verifier: only valid rounds compete (a malformed createdAt never pins an agent).
    if (!c || typeof c !== 'object' || !valid.has(String(c.id)) || typeof c.agentId !== 'string') continue
    const prev = newest.get(c.agentId)
    if (!prev || Date.parse(String(c.createdAt)) > Date.parse(String(prev.createdAt))) newest.set(c.agentId, c)
  }
  const running = (c: RawCampaign) => c.active === true && Date.parse(String(c.until)) > now
  const out = [...raw]
  const outcomes: RenewOutcome[] = []
  for (const [agentId, c] of newest) {
    if (!liveAgentIds.has(agentId)) continue
    const until = Date.parse(String(c.until))
    if (c.active !== true || c.stoppedAt || !(until <= now) || now - until > RENEW_MAX_AGE_MS) continue
    if (!c.keys || typeof c.keys !== 'object') continue
    const lines = c.lineIds as string[]
    // Another agent's running round on one of these lines wins (same rule as the script).
    if (out.some((o) => o && o.agentId !== agentId && running(o) && Array.isArray(o.lineIds) && (o.lineIds as string[]).some((l) => lines.includes(l)))) continue
    const at = new Date(now).toISOString()
    const index = out.indexOf(c)
    if (optOutBlocked.has(String(c.id))) {
      out[index] = { ...c, active: false, stoppedAt: at, stopReason: 'opt_out_guard' }
      outcomes.push({ from: String(c.id), to: null, agentId, why: 'opt_out_guard' })
      continue
    }
    const id = newId()
    out[index] = { ...c, active: false, stoppedAt: at, stopReason: 'auto_renew' }
    const { claimed: _claimed, stoppedAt: _s, stopReason: _r, ...rest } = c
    out.push({ ...rest, id, createdAt: at, until: new Date(now + MAX_CAMPAIGN_HOURS * 3600_000).toISOString(), active: true, claimed: {}, renewedFrom: c.id })
    outcomes.push({ from: String(c.id), to: id, agentId, why: 'renewed' })
  }
  return outcomes.length ? { campaigns: out, outcomes } : null
}

/** How far back the guard pools a round's renewal chain (the same texts) — bounded work every 48 h. */
const GUARD_POOL_MS = 30 * 24 * 3600_000

/** The round plus the rounds it was renewed from (same texts), newest first, created within GUARD_POOL_MS. Pure. */
export function renewalChain(all: RawCampaign[], round: RawCampaign, now: number): RawCampaign[] {
  const byId = new Map(all.filter((c) => c && typeof c.id === 'string').map((c) => [String(c.id), c]))
  const chain: RawCampaign[] = []
  for (let c: RawCampaign | undefined = round; c && !chain.includes(c); c = c.renewedFrom ? byId.get(String(c.renewedFrom)) : undefined) {
    if (now - Date.parse(String(c.createdAt)) > GUARD_POOL_MS) break
    chain.push(c)
  }
  return chain
}

/**
 * Rounds about to be renewed whose text crossed the opt-out guard (per text: ≥ minCount hard opt-outs AND > maxRate).
 * Verifier r2: pooled over the renewal chain (same texts, like --rotate's pairStats), so a low-volume agent and an
 * opt-out that came after a renewal still count.
 */
async function optOutBlockedRounds(tenantId: string, rounds: RawCampaign[], all: RawCampaign[], now: number): Promise<Set<string>> {
  const blocked = new Set<string>()
  for (const round of rounds) {
    const perVariant: Record<string, { sent: number; out: number }> = {}
    for (const c of renewalChain(all, round, now)) {
      const claimed = c.claimed && typeof c.claimed === 'object' ? (c.claimed as Record<string, string>) : {}
      for (const [conversationId, v] of Object.entries(claimed)) {
        if (String(v).endsWith('!')) continue
        const fu = await prisma.$queryRaw<Array<{ sentAt: Date }>>`
          SELECT "sentAt" FROM "ChatMessage"
           WHERE "tenantId" = ${tenantId} AND "conversationId" = ${conversationId} AND "direction" = 'outbound'
             AND "metadata"->'followUp'->>'campaignId' = ${String(c.id)}
           ORDER BY "sentAt" ASC LIMIT 1`
        if (!fu[0]) continue
        const arm = (perVariant[String(v)] ??= { sent: 0, out: 0 })
        arm.sent += 1
        const replies = await prisma.chatMessage.findMany({
          where: { tenantId, conversationId, direction: 'inbound', sentAt: { gt: fu[0].sentAt, lte: new Date(fu[0].sentAt.getTime() + 24 * 3600_000) } },
          select: { content: true },
          take: 10,
        })
        if (replies.some((m) => isOptOutText(m.content))) arm.out += 1
      }
    }
    if (Object.values(perVariant).some((a) => a.out >= OPT_OUT_GUARD.minCount && a.out / a.sent > OPT_OUT_GUARD.maxRate)) blocked.add(String(round.id))
  }
  return blocked
}

/**
 * Cron step before sending: renews (or opt-out-stops) expired rounds under the flag's row lock (the claim UPDATE waits).
 * Uses the flags the caller already read; true = something changed (the caller reads them again). Never throws.
 */
export async function renewFollowUpCampaigns(flags: FlagRow[], now: number): Promise<boolean> {
  let changed = false
  for (const flag of flags) {
    if (!flag.tenantId || flag.scope !== flag.tenantId) continue
    const tenantId = flag.tenantId
    try {
      const raw = Array.isArray((flag.config as { campaigns?: unknown } | null)?.campaigns) ? (flag.config as { campaigns: RawCampaign[] }).campaigns : []
      // Cheapest check (no query): nothing active, past its end and not stopped → nothing to do.
      if (!raw.some((c) => c && c.active === true && !c.stoppedAt && Date.parse(String(c.until)) <= now)) continue
      const live = await prisma.chatAgent.findMany({ where: { tenantId, status: 'live' }, select: { id: true } })
      const liveIds = new Set(live.map((a) => a.id))
      const newId = () => `fu-${new Date(now).toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`
      // Cheap check first (no lock, no message reads): would anything renew?
      const dry = renewExpiredCampaigns(raw, now, liveIds, newId)
      if (!dry) continue
      const due = raw.filter((c) => c && dry.outcomes.some((o) => o.from === c.id))
      const blocked = await optOutBlockedRounds(tenantId, due, raw, now)
      const outcomes = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT "config" FROM "TenantFeatureFlag" WHERE "id" = ${flag.id} AND "key" = ${FOLLOW_UP_FLAG} FOR UPDATE`
        const config = (rows[0]?.config && typeof rows[0].config === 'object' ? rows[0].config : {}) as Record<string, unknown>
        const stored = Array.isArray(config.campaigns) ? (config.campaigns as RawCampaign[]) : []
        const next = renewExpiredCampaigns(stored, now, liveIds, newId, blocked)
        if (!next) return []
        await tx.tenantFeatureFlag.update({ where: { id: flag.id }, data: { config: { ...config, campaigns: next.campaigns } as object } })
        return next.outcomes
      })
      for (const o of outcomes) {
        changed = true
        if (o.why === 'opt_out_guard') console.warn('[follow-up] round stopped by the opt-out guard', o.from)
        await logAuditEvent({
          action: 'UPDATE',
          entityType: 'FollowUpCampaign',
          entityId: tenantId,
          description:
            o.why === 'renewed'
              ? `Follow-up A/B renovado automáticamente ${o.to} (antes ${o.from})`
              : `Follow-up A/B DETENIDO por bajas (${o.from}): no se renovó — revisar el texto con --report y --rotate`,
          newValues: { campaignId: o.to, renewedFrom: o.from, agentId: o.agentId, why: o.why, by: 'cron' },
          userName: 'Betsy (seguimientos automáticos)',
          userRole: 'SYSTEM',
          tenantId,
        }).catch(() => {})
      }
    } catch (error) {
      // Verifier: one tenant's failure never skips the others.
      console.warn('[follow-up] renew failed', error instanceof Error ? error.name : 'unknown')
    }
  }
  return changed
}

/** One cron pass over every active campaign. Never throws; returns how many follow-ups went out. */
export async function runFollowUpCampaigns(opts: { deadlineMs: number; now?: number }): Promise<number> {
  const started = Date.now()
  const now = opts.now ?? Date.now()
  const budget = { sent: 0 }
  const stop = () => Date.now() - started > opts.deadlineMs || budget.sent >= PER_RUN_MAX
  const readFlags = () => prisma.tenantFeatureFlag.findMany({ where: { key: FOLLOW_UP_FLAG, enabled: true }, select: { id: true, tenantId: true, scope: true, config: true } })
  let flags = await readFlags()
  if (await renewFollowUpCampaigns(flags, now)) flags = await readFlags()
  for (const flag of flags) {
    if (!flag.tenantId || flag.scope !== flag.tenantId) continue
    // Index in the STORED array (the claim checks the id at that index too).
    const stored = Array.isArray((flag.config as FollowUpConfig | null)?.campaigns) ? (flag.config as FollowUpConfig).campaigns : []
    for (const c of parseFollowUpConfig(flag.config).campaigns) {
      if (stop()) return budget.sent
      if (!c.active || !(Date.parse(c.until) > now)) continue
      const index = stored.findIndex((s) => s && s.id === c.id)
      if (index < 0) continue
      try {
        await runCampaign(flag.id, flag.tenantId, index, c, now, budget, stop)
      } catch (error) {
        console.warn('[follow-up] campaign run failed', error instanceof Error ? error.name : 'unknown')
      }
    }
  }
  return budget.sent
}

async function runCampaign(
  flagId: string,
  tenantId: string,
  index: number,
  c: FollowUpCampaign,
  now: number,
  budget: { sent: number },
  stop: () => boolean,
): Promise<void> {
  const agent = await prisma.chatAgent.findFirst({ where: { id: c.agentId, tenantId }, select: { id: true, name: true, emoji: true, version: true, status: true } })
  if (!agent || agent.status !== 'live') return
  if (!(await isAiTermsAcceptedNow(tenantId))) return
  // Proactive sends only with configured business hours, and only inside them (never at night).
  const hours = await loadHoursSetup(tenantId, agent.id)
  if (!hours.hours.enabled) return
  if (afterHoursState(hours.hours, new Date(now), { aiDisclosure: hours.aiDisclosure }).afterHours) return
  const silentBefore = new Date(now - c.silentMinMinutes * 60_000)
  for (const lineId of c.lineIds) {
    if (stop()) return
    if (!(await lineAnswersNow(tenantId, lineId))) continue
    const gates = await runPreModelGates({ tenantId, socialAccountId: lineId, agentId: agent.id })
    if (!gates.ok) continue
    // The line must still be served by this campaign's agent.
    const binding = await prisma.chatAgentBinding.findFirst({ where: { tenantId, socialAccountId: lineId, agentId: agent.id, isActive: true }, select: { id: true } })
    if (!binding) continue
    const account = await prisma.socialAccount.findFirst({
      where: { id: lineId, tenantId },
      select: { id: true, platform: true, accessToken: true, accountId: true, pageId: true, refreshToken: true, isActive: true, disconnectedAt: true, tokenStatus: true },
    })
    if (!account || account.isActive === false || account.disconnectedAt) continue
    if (['revoked', 'expired'].includes(String(account.tokenStatus || '').toLowerCase())) continue
    const token = decryptSocialAccessToken(account.accessToken)
    if (!token) continue
    const meta = parseSocialRefreshToken(account.refreshToken)
    const skipped = new Set<string>()
    // Page past claimed / skipped chats (oldest window first) until the run's budget or deadline.
    for (;;) {
      if (stop()) return
      const exclude = [...Object.keys(c.claimed), ...skipped]
      const convs = await prisma.chatConversation.findMany({
        where: {
          tenantId,
          socialAccountId: lineId,
          lastMessageDirection: 'outbound',
          lastInboundAt: { gte: new Date(now - FOLLOW_UP_WINDOW_MS), lte: silentBefore },
          lastMessageAt: { lte: silentBefore },
          ...(exclude.length ? { id: { notIn: exclude } } : {}),
        },
        orderBy: { lastInboundAt: 'asc' },
        take: PAGE,
        select: { id: true, peerId: true, peerName: true, aiMode: true, tags: true, status: true },
      })
      if (!convs.length) break
      for (const conv of convs) {
        if (stop()) return
        if (await followUpSkipReason(tenantId, conv)) {
          skipped.add(conv.id)
          continue
        }
        // Re-read right before sending: the customer may have just written.
        const fresh = await prisma.chatConversation.findFirst({ where: { id: conv.id, tenantId }, select: { lastMessageDirection: true, aiMode: true, tags: true } })
        const inFlight = await prisma.chatAutomationJob.count({ where: { tenantId, conversationId: conv.id, status: { in: ['pending', 'retry', 'processing'] } } })
        if ((await readAgentKillState(tenantId)).armed) return
        if (
          !fresh ||
          inFlight > 0 ||
          fresh.lastMessageDirection !== 'outbound' ||
          fresh.aiMode === 'human' ||
          fresh.aiMode === 'paused' ||
          fresh.tags.includes(PAYMENT_REVIEW_TAG) ||
          fresh.tags.includes(ORDER_REVIEW_TAG)
        ) {
          skipped.add(conv.id)
          continue
        }
        const variant = followUpVariant(c.id, conv.id)
        if (!(await claimChat(flagId, index, c.id, conv.id, variant))) {
          skipped.add(conv.id)
          continue
        }
        c.claimed[conv.id] = variant
        const text = c.texts[variant].trim()
        const result = await sendMetaText({
          platform: account.platform,
          accessToken: token,
          phoneNumberId: account.accountId,
          pageId: account.pageId || meta.pageId,
          recipient: conv.peerId,
          text,
        })
        if (!result.ok) {
          await markFailed(flagId, index, c.id, conv.id, variant)
          continue
        }
        budget.sent += 1
        const write = await dualWriteChatMessage({
          tenantId,
          socialAccountId: account.id,
          direction: 'outbound',
          content: text,
          sentAt: new Date(),
          peerId: conv.peerId,
          peerName: conv.peerName,
          providerMessageId: result.providerMessageId || null,
          messageType: 'text',
          deliveryStatus: 'sent',
          platform: account.platform,
          metadata: {
            softAi: true,
            agentId: agent.id,
            agentVersion: agent.version,
            agentName: agent.name,
            agentEmoji: agent.emoji ?? null,
            to: conv.peerId,
            platform: account.platform,
            providerMessageId: result.providerMessageId || null,
            followUp: { campaignId: c.id, variant },
          },
          suppressSoftAi: true,
          // A nudge never pushes the chat to the top of /chats (it shows under "Seguimientos").
          keepListPosition: true,
        })
        if (!isPersistedDualWrite(write)) console.warn('[follow-up] sent but not stored')
      }
    }
  }
}
