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
 * Campaigns are created / stopped by an audited script and stored in TenantFeatureFlag `agent_follow_up_v1`.
 */
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
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
import { customerTextOf } from '@/lib/soft-ai/inbound-text'

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
    select: { direction: true, content: true, metadata: true, messageType: true },
  })
  const lastOut = recent.find((m) => m.direction === 'outbound')
  if (!lastOut || (lastOut.metadata as { softAi?: unknown } | null)?.softAi !== true) return 'last_reply_by_person'
  // 2026-10-25: a "no me escriban" typed into a WhatsApp edit counts too (inbound-text.ts).
  if (recent.some((m) => m.direction === 'inbound' && isOptOutText(customerTextOf(m)))) return 'opted_out'
  const lastIn = recent.find((m) => m.direction === 'inbound')
  if (lastIn && DECLINE_RE.test(customerTextOf(lastIn))) return 'declined'
  if (recent.some((m) => m.direction === 'outbound' && (m.metadata as { followUp?: unknown } | null)?.followUp)) return 'already_followed_up'
  return null
}

/** One cron pass over every active campaign. Never throws; returns how many follow-ups went out. */
export async function runFollowUpCampaigns(opts: { deadlineMs: number; now?: number }): Promise<number> {
  const started = Date.now()
  const now = opts.now ?? Date.now()
  const budget = { sent: 0 }
  const stop = () => Date.now() - started > opts.deadlineMs || budget.sent >= PER_RUN_MAX
  const flags = await prisma.tenantFeatureFlag.findMany({ where: { key: FOLLOW_UP_FLAG, enabled: true }, select: { id: true, tenantId: true, scope: true, config: true } })
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
