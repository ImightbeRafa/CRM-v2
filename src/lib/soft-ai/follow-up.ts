import 'server-only'
/**
 * Follow-up A/B (Rafael 2026-10-17): one follow-up message to chats where the agent answered and the customer went
 * quiet, split between two texts (A / B) to learn which one closes more. Runs from the chat-automation cron, a few
 * chats per minute, only inside the agent's business hours and inside Meta's 24 h reply window.
 *
 * Never: a second follow-up to the same chat (atomic claim per campaign), a chat a person took over / paused, a chat
 * with a payment or order alert or a linked order, a customer who asked to stop, a chat whose last outbound message was
 * written by a person, a line that does not answer right now. A campaign is created / stopped by an audited script
 * (scripts/agent-pack/follow-up-campaign.ts) and stored in TenantFeatureFlag `agent_follow_up_v1` (no schema change).
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
import { ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG } from '@/lib/crm-stages'

export const FOLLOW_UP_FLAG = 'agent_follow_up_v1'
/** Meta's window is 24 h after the customer's last message; keep a margin. */
export const FOLLOW_UP_WINDOW_MS = 23 * 60 * 60 * 1000
const PER_RUN_MAX = 6
const CANDIDATES = 40

export type FollowUpVariant = 'A' | 'B'
export type FollowUpCampaign = {
  id: string
  agentId: string
  lineIds: string[]
  texts: Record<FollowUpVariant, string>
  createdAt: string
  /** No sends after this time (ISO). */
  until: string
  /** Minimum minutes since the last message before a chat gets its follow-up. */
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

export function parseFollowUpConfig(raw: unknown): FollowUpConfig {
  const campaigns = Array.isArray((raw as FollowUpConfig | null)?.campaigns) ? (raw as FollowUpConfig).campaigns : []
  return {
    campaigns: campaigns.filter(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.agentId === 'string' &&
        Array.isArray(c.lineIds) &&
        typeof c.texts?.A === 'string' &&
        typeof c.texts?.B === 'string' &&
        c.texts.A.trim() &&
        c.texts.B.trim(),
    ).map((c) => ({ ...c, claimed: c.claimed && typeof c.claimed === 'object' ? c.claimed : {} })),
  }
}

/** Atomic claim: only one run (on any instance) can mark this chat for this campaign. */
async function claimChat(flagId: string, index: number, conversationId: string, value: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "TenantFeatureFlag"
    SET "config" = jsonb_set("config", ARRAY['campaigns', ${String(index)}::text, 'claimed', ${conversationId}::text], to_jsonb(${value}::text), true),
        "updatedAt" = now()
    WHERE "id" = ${flagId}
      AND "key" = ${FOLLOW_UP_FLAG}
      AND NOT (COALESCE("config"->'campaigns'->(${index}::int)->'claimed', '{}'::jsonb) ? (${conversationId}::text))
    RETURNING "id"`
  return rows.length === 1
}

async function markFailed(flagId: string, index: number, conversationId: string, variant: FollowUpVariant) {
  await prisma.$executeRaw`
    UPDATE "TenantFeatureFlag"
    SET "config" = jsonb_set("config", ARRAY['campaigns', ${String(index)}::text, 'claimed', ${conversationId}::text], to_jsonb(${`${variant}!`}::text), true)
    WHERE "id" = ${flagId} AND "key" = ${FOLLOW_UP_FLAG}`
}

/** Why a chat gets no follow-up (null = it can get one). Exported for the report / tests. */
export async function followUpSkipReason(tenantId: string, conv: { id: string; aiMode: string | null; tags: string[] }): Promise<string | null> {
  if (conv.aiMode === 'human' || conv.aiMode === 'paused') return 'person_or_paused'
  if (conv.tags.includes(PAYMENT_REVIEW_TAG) || conv.tags.includes(ORDER_REVIEW_TAG)) return 'review_alert'
  const order = await prisma.chatMessage.findFirst({ where: { tenantId, conversationId: conv.id, orderId: { not: null } }, select: { id: true } })
  if (order) return 'has_order'
  const recent = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId: conv.id },
    orderBy: { sentAt: 'desc' },
    take: 30,
    select: { direction: true, content: true, metadata: true },
  })
  const lastOut = recent.find((m) => m.direction === 'outbound')
  if (!lastOut || (lastOut.metadata as { softAi?: unknown } | null)?.softAi !== true) return 'last_reply_by_person'
  if (recent.some((m) => m.direction === 'inbound' && isOptOutText(m.content))) return 'opted_out'
  if (recent.some((m) => m.direction === 'outbound' && (m.metadata as { followUp?: unknown } | null)?.followUp)) return 'already_followed_up'
  return null
}

/** One cron pass over every active campaign. Never throws; returns how many follow-ups went out. */
export async function runFollowUpCampaigns(opts: { deadlineMs: number; now?: number }): Promise<number> {
  const started = Date.now()
  const now = opts.now ?? Date.now()
  let sent = 0
  const flags = await prisma.tenantFeatureFlag.findMany({ where: { key: FOLLOW_UP_FLAG, enabled: true }, select: { id: true, tenantId: true, config: true } })
  for (const flag of flags) {
    if (!flag.tenantId) continue
    const config = parseFollowUpConfig(flag.config)
    for (let index = 0; index < config.campaigns.length; index++) {
      const c = config.campaigns[index]
      if (!c.active || Date.parse(c.until) < now) continue
      try {
        sent += await runCampaign(flag.id, flag.tenantId, index, c, now, () => Date.now() - started > opts.deadlineMs || sent >= PER_RUN_MAX)
      } catch (error) {
        console.warn('[follow-up] campaign run failed', error instanceof Error ? error.name : 'unknown')
      }
      if (Date.now() - started > opts.deadlineMs || sent >= PER_RUN_MAX) return sent
    }
  }
  return sent
}

async function runCampaign(flagId: string, tenantId: string, index: number, c: FollowUpCampaign, now: number, stop: () => boolean): Promise<number> {
  const agent = await prisma.chatAgent.findFirst({ where: { id: c.agentId, tenantId }, select: { id: true, name: true, emoji: true, version: true, status: true } })
  if (!agent || agent.status !== 'live') return 0
  // Only inside the agent's business hours (no follow-up at night).
  const hours = await loadHoursSetup(tenantId, agent.id)
  if (afterHoursState(hours.hours, new Date(now), { aiDisclosure: hours.aiDisclosure }).afterHours) return 0
  let sent = 0
  for (const lineId of c.lineIds) {
    if (stop()) break
    if (!(await lineAnswersNow(tenantId, lineId))) continue
    const account = await prisma.socialAccount.findFirst({
      where: { id: lineId, tenantId },
      select: { id: true, platform: true, accessToken: true, accountId: true, pageId: true, refreshToken: true, isActive: true, disconnectedAt: true },
    })
    if (!account || account.isActive === false || account.disconnectedAt) continue
    const token = decryptSocialAccessToken(account.accessToken)
    if (!token) continue
    const convs = await prisma.chatConversation.findMany({
      where: {
        tenantId,
        socialAccountId: lineId,
        lastMessageDirection: 'outbound',
        lastInboundAt: { gte: new Date(now - FOLLOW_UP_WINDOW_MS), lte: new Date(now - c.silentMinMinutes * 60_000) },
        lastMessageAt: { lte: new Date(now - c.silentMinMinutes * 60_000), gte: new Date(Date.parse(c.createdAt) - FOLLOW_UP_WINDOW_MS) },
      },
      // Oldest first: those leave Meta's window soonest.
      orderBy: { lastInboundAt: 'asc' },
      take: CANDIDATES,
      select: { id: true, peerId: true, peerName: true, aiMode: true, tags: true },
    })
    for (const conv of convs) {
      if (stop()) break
      if (c.claimed[conv.id]) continue
      if (await followUpSkipReason(tenantId, conv)) continue
      const variant = followUpVariant(c.id, conv.id)
      if (!(await claimChat(flagId, index, conv.id, variant))) continue
      const text = c.texts[variant].trim()
      const meta = parseSocialRefreshToken(account.refreshToken)
      const result = await sendMetaText({
        platform: account.platform,
        accessToken: token,
        phoneNumberId: account.accountId,
        pageId: account.pageId || meta.pageId,
        recipient: conv.peerId,
        text,
      })
      if (!result.ok) {
        await markFailed(flagId, index, conv.id, variant)
        continue
      }
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
      })
      if (!isPersistedDualWrite(write)) console.warn('[follow-up] sent but not stored')
      sent += 1
    }
  }
  return sent
}
