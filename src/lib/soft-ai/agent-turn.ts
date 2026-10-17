/**
 * Soft Agent Layer turn orchestration — generate, persist, gate, deliver or suggest.
 * Extends Phase 4 queue; never imports staff bot.
 */

import { randomUUID } from 'node:crypto'
import { probarWhy } from '@/lib/soft-ai/probar-why'
import { probarOutcomeCodes } from '@/lib/soft-ai/test-engine/why'
import { afterHoursNoteRejected } from '@/lib/soft-ai/after-hours-note'
import {
  AFTER_HOURS_REVIEW_PREFIX,
  afterHoursPromptLine,
  afterHoursReviewLine,
  withNightIntro,
  afterHoursState,
  applyAfterHoursText,
  DEFAULT_BUSINESS_HOURS,
  IN_HOURS,
  type AfterHoursState,
  type BusinessHours,
} from '@/lib/soft-ai/business-hours'
import { loadAgentSalesContext } from '@/lib/soft-ai/agent-sales-context'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  deliverOnce,
  hashSoftAiDeliveryContent,
} from '@/lib/soft-ai/automation-delivery'
import { newerBurstJobPending, type ClaimedChatAutomationJob } from '@/lib/soft-ai/automation-queue'
import {
  burstHasLaterBubble,
  burstOutgrowsWindow,
  burstReviewIn,
  burstOptOutIn,
  planBurstInbound,
  BURST_LOAD_MAX,
  BURST_MAX_AGE_MS,
  BURST_YIELD_MAX_AGE_MS,
  shouldYieldToNewerBurst,
  unansweredBurst,
  type BurstMessage,
} from '@/lib/soft-ai/inbound-burst'
import {
  collectDryRunBlockers,
  hashSoftAiOutput,
  hasHumanRepliedAfter,
  loadDailyTestTokens,
  runClaimGates,
  runPreModelGates,
  runPreSendGates,
} from '@/lib/soft-ai/agent-claim-gates'
import {
  resolveChatAgent,
  type AgentResolveResult,
  type ResolvedChatAgent,
} from '@/lib/soft-ai/agent-resolver'
import { burstCustomerText, recentCustomerTexts, runSoftAiLlmRuntime } from '@/lib/soft-ai/llm/runtime'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  HISTORY_WINDOW_MAX,
  isAllowedChatAgentModel,
  pricingVersionFor,
  type EffectiveAgentBehavior,
} from '@/lib/soft-ai/agent-types'
import { loadMappedInventoryIds } from '@/lib/soft-ai/agent-inventory-map'
import { loadAgentSettings } from '@/lib/soft-ai/agent-settings'
import { notifyAiNoReply } from '@/lib/soft-ai/ai-no-reply'
import { acquireProbarSlot, releaseProbarSlot } from '@/lib/soft-ai/probar-slots'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { isPlatformAiPaused, readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { isSoftAiProviderConfigured } from '@/lib/soft-ai/llm/client'
import { estimateCostMicros } from '@/lib/soft-ai/llm/usage'
import {
  assembleAgentRuntimeInputs,
  channelBindingBlocker,
  chatHistoryWhere,
  loadCanalContextForAccount,
  toResolvedChatAgent,
  windowedAgentHistory,
} from '@/lib/soft-ai/agent-turn-inputs'
import {
  applySafeLineCap,
  behaviorForOperationMode,
  HANDOFF_REASON,
  decideTurnOutcome,
  planDecisionDelivery,
  planModelTurnDelivery,
  PROBAR_NOT_SIMULATED_GATES,
  readOutcomeMarkers,
  SAFE_LINE,
  withDelayApology,
  withOutcomeMarkers,
  type AgentTurnOutcome,
  type OutcomeMarkers,
  type TurnDeliveryPlan,
  type TurnHandoff,
} from '@/lib/soft-ai/agent-turn-outcome'
import { notifyHandoff } from '@/lib/soft-ai/handoff-notify'
import { decideWaitingAck, isOptOutText, waitingAckKey, waitingAckText, WAITING_ACK_KEY_PREFIX, WAITING_ACK_MAX_AGE_MS, WAITING_ALERT_THROTTLE_MS } from '@/lib/soft-ai/waiting-ack'
import { isSoftAiOutboundMetadata } from '@/lib/soft-ai/agent-inbox-projection'
import { dropRepeatedParts, REPEAT_WINDOW_MS } from '@/lib/soft-ai/repeat-guard'
import { awaitingPaymentMethodChoice, isMediaLikeMessageType, mediaAwaitingReceipt } from '@/lib/soft-ai/sales-state'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { loadApprovedKnowledgeForAgent } from '@/lib/soft-ai/knowledge-repository'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { decideBurstTurn } from '@/lib/soft-ai/burst-decision'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import { loadReplyAssets } from '@/lib/soft-ai/agent-assets'
import { selectReplyImages, sendableImageReplyIds, type ReplyImage } from '@/lib/soft-ai/reply-images'
import type { AgentAsset } from '@/lib/soft-ai/agent-assets'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { AGENT_IMAGE_DEADLINE_MS, loadSentAgentImageShas, sendAgentImagesOnce } from '@/lib/soft-ai/agent-media-send'
import { applyFinalOutputPolicy, splitReplyParts, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { AGENT_PARTS_DEADLINE_MS, planReplyParts, remainderPart } from '@/lib/soft-ai/reply-parts'
import { DEFAULT_REPLY_PACE, planPartWait, type ReplyPace } from '@/lib/soft-ai/reply-pace'
import { sendWhatsappTypingIndicator } from '@/lib/soft-ai/typing-indicator'
import { loadSalesSetup } from '@/lib/soft-ai/agent-sales-setup'
import { maskConfiguredPaymentSecrets, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { redactToolTrace } from '@/lib/soft-ai/llm/redact'
import {
  hasAiFullUnlock,
  isAccountAllowlisted,
  parseChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-config'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { dualWriteChatMessage } from '@/lib/chat-conversation-write'
import {
  effectiveConversationAiMode,
  humanWroteRecently,
  maySoftAiMetaReply,
  normalizeConversationAiMode,
  resolvePersistedAgentMode,
  resolveSoftAiAgentMode,
  softAiConversationKey,
} from '@/lib/soft-ai/agent-mode-server'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { readSoftTenantAiConfig } from '@/lib/feature-flags'
import { turnWasCodeDecided } from '@/lib/soft-ai/turn-origin'

type JobPayload = {
  platform?: string | null
  content?: string | null
  senderName?: string | null
  /** Set by the waiting sweep (stream C): 'explicit' | 'periodic'. */
  sweep?: string | null
}

function readPayload(payload: unknown): JobPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const p = payload as Record<string, unknown>
  return {
    platform: typeof p.platform === 'string' ? p.platform : null,
    content: typeof p.content === 'string' ? p.content : null,
    senderName: typeof p.senderName === 'string' ? p.senderName : null,
    sweep: typeof p.sweep === 'string' ? p.sweep : null,
  }
}

/** Verifier F5: the composed after-hours text (with the owner's note) has no leftover token / template / tag. */
const AFTER_HOURS_LEFTOVER = new Set(['unknown_token', 'template_leak', 'tag_leak'])
function afterHoursComposedOk(text: string): boolean {
  return !validateAgentOutput({ text, citedToolNames: [] }).reasons.some((r) => AFTER_HOURS_LEFTOVER.has(r))
}
/** Live and Probar: same after-hours text rules (INT-120: the owner's note is re-checked at send). */
const AFTER_HOURS_TEXT_OPTS = {
  safeReview: SAFE_LINE.review,
  paymentSoon: SAFE_LINE.paymentSoon,
  noteOk: (note: string) => !afterHoursNoteRejected(note),
  composedOk: afterHoursComposedOk,
}

/** A planned reply (B1) gets the sweep apology when the customer waited > 30 min (B9). Never on a payment hand-off. */
function finalizePlannedText(plan: TurnDeliveryPlan, payload: JobPayload, triggerSentAt: Date, hours: AfterHoursState = IN_HOURS): string {
  // agents2-hours: after hours a TRUE hand-off tells the customer when the team answers (code-owned text), and the
  // safe lines that promise immediacy get the after-hours wording. In hours / off: unchanged.
  const text = applyAfterHoursText(plan, hours, AFTER_HOURS_TEXT_OPTS)
  if (plan.handoff?.kind === 'handoff') return text
  return withDelayApology(text, { sweep: Boolean(payload.sweep), messageAgeMs: Date.now() - triggerSentAt.getTime() })
}

/** The customer's messages since the store last wrote, oldest first, plus this one. */
function customerTextSinceLastAnswer(history: Array<{ direction: string; content?: string | null }>, current: string | null | undefined): string {
  const since: string[] = []
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].direction === 'outbound') break
    if (history[i].content) since.unshift(String(history[i].content))
  }
  return [...since, current || ''].join('\n')
}

/**
 * The customer's earlier messages for the burst claim check: since the store last wrote, plus any from the last 10 min
 * (SecureDog round 7: a message typed while the store's reply was being written sorts before that reply).
 */
function earlierCustomerTexts(history: Array<{ direction: string; content?: string | null; sentAt?: string | Date | null }>): string[] {
  return recentCustomerTexts(history, 10 * 60_000, 6)
}

/** luna-10 night intro: the agent's first name, the store, and whether anyone already wrote to this customer. */
function nightIntroWho(
  agent: { introductionNames?: string[] | null; brandFacts?: { storeName?: string | null } | null },
  history: Array<{ direction: string }>,
): { name: string | null; store: string | null; introduced: boolean } {
  return {
    name: (agent.introductionNames || []).find((n) => typeof n === 'string' && n.trim()) ?? null,
    store: agent.brandFacts?.storeName ?? null,
    introduced: history.some((h) => h.direction === 'outbound'),
  }
}

/** B1 loop cap: did this chat already get the safe line in the last 30 min (another job)? */
async function safeLineSentRecently(tenantId: string, conversationId: string, deliveryKey: string): Promise<boolean> {
  try {
    const row = await prisma.chatAgentTurn.findFirst({
      where: {
        tenantId,
        conversationId,
        status: 'delivered',
        // agents2-hours: the after-hours safe line counts too (same loop cap at night).
        OR: [{ outputText: SAFE_LINE.review }, { outputText: { startsWith: AFTER_HOURS_REVIEW_PREFIX } }],
        completedAt: { gte: new Date(Date.now() - 30 * 60_000) },
        NOT: { automationDeliveryKey: deliveryKey },
      },
      select: { id: true },
    })
    return Boolean(row)
  } catch (error) {
    if (isMissingRelationError(error)) return false
    throw error
  }
}

function plannedMarkers(base: { needsHuman: boolean; fallbackUsed: boolean; escalate: boolean }, handoff: TurnHandoff | null): OutcomeMarkers {
  return { ...base, planned: true, handoffKind: handoff?.kind ?? null, handoffReason: handoff?.reason ?? null }
}

async function loadHistory(
  conversationId: string,
  triggerMessageId: string,
): Promise<{ history: SoftAiHistoryMessage[]; messageTypeOf: Map<string, string | null>; loadedRows: number }> {
  const rows = await prisma.chatMessage.findMany({
    where: chatHistoryWhere(conversationId, triggerMessageId),
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: HISTORY_WINDOW_MAX,
    select: {
      id: true,
      direction: true,
      content: true,
      sentAt: true,
      // Burst = one reply: which earlier bubbles of the burst are photos / audios (inbound-burst.ts).
      messageType: true,
    },
  })
  const kept = rows.reverse().filter((r) => r.direction === 'inbound' || r.direction === 'outbound')
  return {
    history: kept.map((r) => ({
      id: r.id,
      direction: r.direction as 'inbound' | 'outbound',
      content: r.content,
      sentAt: r.sentAt.toISOString(),
    })),
    messageTypeOf: new Map(kept.map((r) => [r.id, r.messageType ?? null])),
    loadedRows: rows.length,
  }
}

/**
 * Burst = one reply, longer than the history window (a WhatsApp multi-forward of 24+ bubbles): the customer's
 * unanswered bubbles on their own — inbound after the store's last reply, sent at most BURST_MAX_AGE_MS before the
 * trigger, newest BURST_LOAD_MAX — so every one still gets its opt-out / receipt / payment-claim check. Only what the
 * burst checks is loaded (text, type, time); the model keeps its 24-row window. Same tenant and chat only.
 */
async function loadUnansweredInbound(input: {
  tenantId: string
  conversationId: string
  triggerMessageId: string
  triggerSentAt: Date
}): Promise<BurstMessage[]> {
  const since = new Date(input.triggerSentAt.getTime() - BURST_MAX_AGE_MS)
  const lastReply = await prisma.chatMessage.findFirst({
    where: { tenantId: input.tenantId, conversationId: input.conversationId, direction: 'outbound' },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    select: { id: true, sentAt: true },
  })
  const rows = await prisma.chatMessage.findMany({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      direction: 'inbound',
      id: { not: input.triggerMessageId },
      // After the last reply in the history's own (sentAt, id) order: a bubble sent in the same WhatsApp second as a
      // reply typed on the phone still counts when its id sorts after it (Verifier: same-second tie).
      ...(lastReply && lastReply.sentAt >= since
        ? { OR: [{ sentAt: { gt: lastReply.sentAt } }, { sentAt: lastReply.sentAt, id: { gt: lastReply.id } }] }
        : { sentAt: { gte: since } }),
    },
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: BURST_LOAD_MAX,
    select: { content: true, messageType: true, sentAt: true },
  })
  return rows.reverse().map((r) => ({
    direction: 'inbound' as const,
    content: r.content,
    messageType: r.messageType ?? null,
    sentAt: r.sentAt.toISOString(),
  }))
}

/**
 * Burst = one reply: a newer customer bubble of this chat is queued and this trigger is still fresh → this job stops
 * (superseded) and the newer job answers the whole burst. Checked before the model and right before the send.
 * Never for a planned TRUE hand-off (opt-out, payment, …: it goes out and the chat goes to a person) and never on a
 * reclaimed job (attempts > 1: its turn row may already hold a delivery).
 */
async function yieldsToNewerBurst(
  row: ClaimedChatAutomationJob,
  triggerSentAt: Date,
  plannedHandoff: TurnHandoff | null = null,
  stage: 'pre_model' | 'pre_send' = 'pre_model',
): Promise<boolean> {
  if (plannedHandoff?.kind === 'handoff' || row.attempts > 1) return false
  if (!shouldYieldToNewerBurst({ newerPending: await newerBurstJobPending(row, triggerSentAt), triggerSentAt })) return false
  // SecureDog INT (cost): at most one written-then-dropped reply per burst. When a reply of this chat was already
  // dropped for a newer bubble in the last minute, this one goes out (a customer typing every few seconds still
  // gets answers, and the model is not run again and again for nothing).
  if (stage === 'pre_send' && (await recentlyDroppedGeneratedReply(row))) return false
  return true
}

async function recentlyDroppedGeneratedReply(row: ClaimedChatAutomationJob): Promise<boolean> {
  const dropped = await prisma.chatAgentTurn.findFirst({
    where: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      status: 'skipped',
      skipReason: 'superseded',
      outputText: { not: null },
      completedAt: { gte: new Date(Date.now() - BURST_YIELD_MAX_AGE_MS) },
    },
    select: { id: true },
  })
  return Boolean(dropped)
}

/** A generated reply that is not sent because a newer burst job answers instead (tokens stay on the row). */
async function markTurnSuperseded(row: ClaimedChatAutomationJob, turnId: string): Promise<AgentTurnDispatchResult> {
  await prisma.chatAgentTurn.updateMany({
    where: { id: turnId, tenantId: row.tenantId, status: 'generated' },
    data: { status: 'skipped', skipReason: 'superseded', completedAt: new Date() },
  })
  return { status: 'skipped', reason: 'superseded' }
}

async function loadTriggerMessage(messageId: string, tenantId: string, conversationId: string) {
  // SecureDog: scoped to this job's business and chat (never another tenant's message by id).
  return prisma.chatMessage.findFirst({
    where: { id: messageId, tenantId, conversationId },
    select: {
      id: true,
      sentAt: true,
      content: true,
      messageType: true,
      direction: true,
      // agents2-pace: the WhatsApp message id (wamid) the "escribiendo…" indicator points at.
      providerMessageId: true,
    },
  })
}

async function sendMetaText(opts: {
  platform: string
  accessToken: string
  phoneNumberId?: string | null
  pageId?: string | null
  recipient: string
  text: string
}): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
  const token = opts.accessToken
  try {
    if (opts.platform === 'whatsapp') {
      if (!opts.phoneNumberId) return { ok: false, error: 'missing_phone_number_id' }
      const url = addAppSecretProofToUrl(
        buildMetaGraphUrl(`${opts.phoneNumberId}/messages`),
        token,
        { purpose: 'whatsapp' },
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: opts.recipient,
          type: 'text',
          text: { body: opts.text },
        }),
        signal: AbortSignal.timeout(7_000),
      })
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>
        error?: { message?: string }
      }
      if (!res.ok) {
        return { ok: false, error: data.error?.message || `meta_${res.status}` }
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id }
    }
    if (opts.platform === 'instagram') {
      // Same call as the Chats composer (api/chat/send): RESPONSE inside the 24h window only. The AI never uses
      // the HUMAN_AGENT tag (Meta allows it for human replies only).
      const sendPath = opts.pageId ? `${encodeURIComponent(opts.pageId)}/messages` : 'me/messages'
      const url = addAppSecretProofToUrl(buildMetaGraphUrl(sendPath), token)
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_type: 'RESPONSE', recipient: { id: opts.recipient }, message: { text: opts.text } }),
        signal: AbortSignal.timeout(7_000),
      })
      const data = (await res.json().catch(() => ({}))) as {
        message_id?: string
        messages?: Array<{ id?: string }>
        error?: { message?: string }
      }
      if (!res.ok) return { ok: false, error: data.error?.message || `meta_${res.status}` }
      return { ok: true, providerMessageId: data.message_id || data.messages?.[0]?.id }
    }
    return { ok: false, error: 'platform_not_supported_for_agent_send' }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 80) : 'meta_send_failed',
    }
  }
}

/** Channels where the agent's saved-reply images really go out (live, planning and Probar use the same rule). */
export function imageChannel(platform: string | null | undefined): boolean {
  const p = platform || 'whatsapp'
  return p === 'whatsapp' || p === 'instagram'
}

async function channelHasActivationRecord(tenantId: string, socialAccountId: string): Promise<boolean> {
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId, scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { config: true },
  })
  return Boolean(parseChatAgentLayerConfig(flag?.config).aiFullUnlock[socialAccountId])
}

async function persistSkippedTurn(input: {
  tenantId: string
  conversationId: string
  socialAccountId: string
  agent: ResolvedChatAgent | null
  bindingId?: string | null
  triggerMessageId: string
  deliveryKey: string
  skipReason: string
  status?: string
  mode?: string
}) {
  if (!input.agent) return
  try {
    await prisma.chatAgentTurn.upsert({
      where: { automationDeliveryKey: input.deliveryKey },
      create: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        socialAccountId: input.socialAccountId,
        agentId: input.agent.id,
        bindingId: input.bindingId || null,
        triggerMessageId: input.triggerMessageId,
        automationDeliveryKey: input.deliveryKey,
        mode: input.mode || input.agent.operationMode,
        model: input.agent.model,
        agentVersion: input.agent.version,
        status: input.status || 'skipped',
        skipReason: input.skipReason,
        completedAt: new Date(),
      },
      update: {
        status: input.status || 'skipped',
        skipReason: input.skipReason,
        completedAt: new Date(),
      },
    })
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
}

/**
 * luna-10 #4 (waiting-ack.ts): the chat is with a person after the agent's hand-off and the customer wrote again.
 * One code line per hand-off + a fresh team alert per customer message. Silent when a person already wrote, when a
 * person took the chat by hand, or when the line is off. Never changes aiMode; never throws (a failure only logs).
 */
async function ackWaitingCustomer(input: {
  row: ClaimedChatAutomationJob
  payload: JobPayload
  conversation: { peerName: string | null }
  agent: ResolvedChatAgent
  bindingId: string | null
}): Promise<void> {
  const { row } = input
  try {
    const lastTurn = await prisma.chatAgentTurn.findFirst({
      where: {
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        status: 'delivered',
        testSessionId: null,
        createdAt: { gte: new Date(Date.now() - WAITING_ACK_MAX_AGE_MS) },
        NOT: { automationDeliveryKey: { startsWith: WAITING_ACK_KEY_PREFIX } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, decisionTrace: true, completedAt: true, triggerMessageId: true },
    })
    const handoffKind = lastTurn ? readOutcomeMarkers(lastTurn.decisionTrace)?.handoffKind ?? null : null
    // Verifier F9: most human-mode messages are not after an agent hand-off — leave before the heavier checks.
    if (!lastTurn || handoffKind !== 'handoff') return
    const since = lastTurn.completedAt ?? new Date()
    const outboundSince = await prisma.chatMessage.findMany({
      where: { tenantId: row.tenantId, conversationId: row.conversationId, direction: 'outbound', sentAt: { gt: since } },
      select: { metadata: true },
      take: 50,
    })
    const probe = await resolveChatAgent({ tenantId: row.tenantId, socialAccountId: row.socialAccountId, conversationAiMode: 'ai_active' })
    const gates = probe.kind === 'resolved' ? await runPreModelGates({ tenantId: row.tenantId, socialAccountId: row.socialAccountId, agentId: probe.agent.id }) : null
    // Verifier F3: the kill switch, the platform pause and the AI terms stop the ack like any other send.
    const lineOn =
      probe.kind === 'resolved' &&
      probe.agent.operationMode === 'ai_full' &&
      probe.unlockedForSend &&
      Boolean(gates?.ok) &&
      !(await readAgentKillState(row.tenantId)).armed &&
      !(await isPlatformAiPaused()) &&
      (await isAiTermsAcceptedNow(row.tenantId))
    // Verifier F7: after "STOP" / "no quiero bot" the customer gets no more automatic text (the team is still alerted).
    const handoffTrigger = lastTurn.triggerMessageId
      ? await prisma.chatMessage.findFirst({ where: { id: lastTurn.triggerMessageId, tenantId: row.tenantId }, select: { content: true } })
      : null
    // SecureDog R3 (burst): "STOP" + "hola" while the chat waits on a person — the STOP bubble's job was superseded, so
    // every customer message since the hand-off is read, not only this one.
    const inboundSince = await prisma.chatMessage.findMany({
      where: { tenantId: row.tenantId, conversationId: row.conversationId, direction: 'inbound', sentAt: { gt: since } },
      select: { content: true },
      take: 50,
    })
    const key = waitingAckKey(lastTurn.id)
    const alreadyAcked = Boolean(await prisma.chatAgentTurn.findUnique({ where: { automationDeliveryKey: key }, select: { id: true } }))
    const decision = decideWaitingAck({
      lastTurn: { id: lastTurn.id, handoffKind, completedAt: lastTurn.completedAt },
      humanWroteSince: outboundSince.some((m) => !isSoftAiOutboundMetadata(m.metadata)),
      lineOn,
      alreadyAcked,
      // Verifier round 2 #4: the opt-out can be the hand-off message OR this new one ("no me escriban más").
      // SecureDog (burst): the hand-off may come from another bubble of its burst ("STOP" + "por favor").
      optOut:
        isOptOutText(handoffTrigger?.content) ||
        isOptOutText(input.payload.content) ||
        burstOptOutIn(lastTurn.decisionTrace) ||
        inboundSince.some((m) => isOptOutText(m.content)),
      now: new Date(),
    })
    if (!decision.realert) return

    const hoursSetup = await loadHoursSetup(row.tenantId, input.agent.id)
    const hours = afterHoursState(hoursSetup.hours, new Date(), { aiDisclosure: hoursSetup.aiDisclosure })
    // SecureDog (INT): at most one "sigue esperando" alert per chat every 15 minutes ("gracias", "👍" × 50 ≠ 50 bells).
    const recentWaitingAlert = await prisma.workspaceNotification.findFirst({
      where: {
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        dedupeKey: { startsWith: `ai_handoff:${row.conversationId}:`, contains: ':customer_waiting' },
        createdAt: { gte: new Date(Date.now() - WAITING_ALERT_THROTTLE_MS) },
      },
      select: { id: true },
    })
    if (!recentWaitingAlert) {
      await notifyHandoff({
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        socialAccountId: row.socialAccountId,
        kind: 'handoff',
        reason: 'customer_waiting',
        quietUntil: hours.afterHours ? hours.opensAt : null,
      })
    }
    if (!decision.ack) return

    const text = waitingAckText(hours)
    // The unique delivery key is the lock: a second job for the same hand-off never sends a second ack.
    let ackTurnId: string
    try {
      const created = await prisma.chatAgentTurn.create({
        data: {
          tenantId: row.tenantId,
          conversationId: row.conversationId,
          socialAccountId: row.socialAccountId,
          agentId: input.agent.id,
          bindingId: input.bindingId,
          triggerMessageId: null,
          automationDeliveryKey: key,
          mode: input.agent.operationMode,
          model: input.agent.model,
          agentVersion: input.agent.version,
          status: 'generated',
          intent: 'waiting_ack',
          outputText: text,
          outputHash: hashSoftAiDeliveryContent(text),
        },
        select: { id: true },
      })
      ackTurnId = created.id
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return
      throw error
    }

    const account = await prisma.socialAccount.findFirst({
      where: { id: row.socialAccountId, tenantId: row.tenantId },
      select: { accessToken: true, refreshToken: true, accountId: true, pageId: true, isActive: true, disconnectedAt: true, tokenStatus: true },
    })
    const accessToken = account?.accessToken ? decryptSocialAccessToken(account.accessToken) : null
    // SecureDog (INT): a disconnected / revoked / expired line never sends, like the main reply's token gate.
    const tokenStatus = String(account?.tokenStatus || '').toLowerCase()
    const lineHealthy = Boolean(account && accessToken && account.isActive !== false && !account.disconnectedAt && tokenStatus !== 'revoked' && tokenStatus !== 'expired')
    // Kill switch armed meanwhile (incident): re-checked right before the send.
    if (!lineHealthy || (await readAgentKillState(row.tenantId)).armed || (await isPlatformAiPaused())) {
      await prisma.chatAgentTurn.update({ where: { id: ackTurnId }, data: { status: 'skipped', skipReason: lineHealthy ? 'kill_switch' : 'token_unhealthy', completedAt: new Date() } })
      return
    }
    const meta = parseSocialRefreshToken(account!.refreshToken)
    const platform = input.payload.platform || 'whatsapp'
    const ackDelivery = await deliverOnce({
      jobId: row.id,
      deliveryKey: `${row.deliveryKey}:waiting_ack`,
      kind: 'text',
      contentHash: hashSoftAiDeliveryContent(text),
      send: async () => {
        const result = await sendMetaText({ platform, accessToken: accessToken!, phoneNumberId: account!.accountId, pageId: account!.pageId || meta.pageId, recipient: row.peerId, text })
        if (!result.ok) throw new Error('META_SEND_FAILED')
        return result
      },
      providerDeliveryId: (result) => result.providerMessageId,
    })
    const providerMessageId = ackDelivery.providerDeliveryId || (!ackDelivery.skipped ? ackDelivery.result?.providerMessageId : undefined)
    await dualWriteChatMessage({
      tenantId: row.tenantId,
      socialAccountId: row.socialAccountId,
      direction: 'outbound',
      content: text,
      sentAt: new Date(),
      peerId: row.peerId,
      peerName: input.payload.senderName || input.conversation.peerName || null,
      providerMessageId: providerMessageId || null,
      messageType: 'text',
      // Answers only up to the hand-off's own customer message: the new messages stay "waiting for the team".
      answersMessageId: lastTurn.triggerMessageId,
      deliveryStatus: 'sent',
      platform,
      metadata: {
        softAi: true,
        agentId: input.agent.id,
        agentVersion: input.agent.version,
        agentName: input.agent.name,
        agentEmoji: input.agent.emoji,
        turnId: ackTurnId,
        to: row.peerId,
        platform,
        providerMessageId,
        automationJobId: row.id,
        deliverySkipped: ackDelivery.skipped,
        replyBy: 'code',
        waitingAck: true,
      },
      suppressSoftAi: true,
    })
    await prisma.chatAgentTurn.update({ where: { id: ackTurnId }, data: { status: 'delivered', completedAt: new Date() } })
  } catch (error) {
    console.error('[soft-ai waiting-ack]', { code: error instanceof Error ? error.message.slice(0, 60) : 'error' })
  }
}

/**
 * Daily token caps sum turns by createdAt (agent-claim-gates loadDailyBilledTokens). A swept / resumed message re-runs
 * on the row first written when it was skipped (same delivery key), so the answering run re-stamps the row: today's
 * date and the agent that actually answers (Verifier 2026-10-15 F1).
 */
export function rebillTurnFields(input: { agentId: string; bindingId: string | null; model: string; agentVersion: number }) {
  return {
    createdAt: new Date(),
    agentId: input.agentId,
    bindingId: input.bindingId,
    model: input.model,
    agentVersion: input.agentVersion,
  }
}

export type AgentTurnDispatchResult =
  | { status: 'skipped'; reason?: string }
  | { status: 'suggested'; turnId: string }
  | { status: 'delivered'; turnId: string; skippedDelivery?: boolean; partialDelivery?: boolean }
  | { status: 'fallback'; turnId?: string }
  | { status: 'legacy' }

/**
 * Decide Agent Layer vs legacy. Returns 'legacy' when flag off so processor
 * keeps executeSoftAiInboundTurn. Allowlisted-but-skipped never falls back to legacy.
 */
export async function shouldUseAgentLayer(input: {
  tenantId: string
  socialAccountId: string
}): Promise<{ useAgent: boolean; reason?: string }> {
  const resolved = await resolveChatAgent({
    tenantId: input.tenantId,
    socialAccountId: input.socialAccountId,
    conversationAiMode: 'ai_active', // probe only for layer/allowlist; real mode resolved later
  })
  if (!resolved.layerEnabled) return { useAgent: false, reason: 'flag_off' }
  if (resolved.skipReason === 'account_not_allowlisted') {
    return { useAgent: true, reason: 'account_not_allowlisted' }
  }
  if (resolved.skipReason === 'flag_off' && resolved.layerEnabled) {
    return { useAgent: false, reason: 'soft_flag_off' }
  }
  return { useAgent: true }
}

export async function executeAgentLayerTurn(
  row: ClaimedChatAutomationJob,
  opts?: { superseded?: boolean },
): Promise<AgentTurnDispatchResult> {
  const turnStartedAt = Date.now()
  const payload = readPayload(row.payload)
  if (!payload.content || !payload.platform) {
    throw new Error('SOFT_AI_PAYLOAD_INVALID')
  }

  const conversation = await prisma.chatConversation.findFirst({
    where: { id: row.conversationId, tenantId: row.tenantId },
    select: {
      id: true,
      aiMode: true,
      clientId: true,
      lastInboundAt: true,
      peerId: true,
      peerName: true,
      socialAccountId: true,
    },
  })
  if (!conversation) {
    return { status: 'skipped', reason: 'conversation_missing' }
  }

  const softConfig = await readSoftTenantAiConfig(row.tenantId)
  const flagConfig =
    softConfig.config && typeof softConfig.config === 'object' && !Array.isArray(softConfig.config)
      ? (softConfig.config as Record<string, unknown>)
      : {}
  const conversationKey = softAiConversationKey(row.socialAccountId, row.peerId)
  const persistedMode = resolvePersistedAgentMode(flagConfig, conversationKey)
  let agentMode = resolveSoftAiAgentMode({
    conversationAiMode: conversation.aiMode,
    flagConfig,
    conversationKey,
  })
  if (!agentMode) {
    // Agentes IA 2.0: a chat with no mode follows its line (on → IA), unless a person wrote in it in the last 24 h.
    const probe = await resolveChatAgent({
      tenantId: row.tenantId,
      socialAccountId: row.socialAccountId,
      conversationAiMode: 'ai_active',
    })
    const lineOn = probe.kind === 'resolved' && probe.agent.operationMode === 'ai_full' && probe.unlockedForSend
    agentMode = effectiveConversationAiMode({
      column: conversation.aiMode,
      persisted: persistedMode,
      lineOn,
      humanWroteRecently: lineOn ? await humanWroteRecently(row.tenantId, row.conversationId) : false,
    }).mode
  }

  const resolved = await resolveChatAgent({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    conversationAiMode: agentMode,
  })

  if (!resolved.layerEnabled) {
    return { status: 'legacy' }
  }

  if (resolved.kind === 'skip') {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent || null,
      bindingId: resolved.binding?.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: resolved.skipReason,
    })
    // luna-10 #4: the customer writes again while the agent's hand-off still waits on a person.
    if (resolved.skipReason === 'human_before_send' && resolved.agent) {
      await ackWaitingCustomer({ row, payload, conversation, agent: resolved.agent, bindingId: resolved.binding?.id ?? null })
    }
    return { status: 'skipped', reason: resolved.skipReason }
  }

  const trigger = await loadTriggerMessage(row.messageId, row.tenantId, row.conversationId)
  if (!trigger) {
    return { status: 'skipped', reason: 'trigger_missing' }
  }

  const claimGate = await runClaimGates({
    tenantId: row.tenantId,
    conversationId: row.conversationId,
    triggerMessageId: row.messageId,
    triggerSentAt: trigger.sentAt,
    superseded: Boolean(opts?.superseded),
  })
  if (!claimGate.ok) {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: claimGate.skipReason || 'superseded',
      status: claimGate.status,
    })
    return { status: 'skipped', reason: claimGate.skipReason }
  }

  // Burst = one reply: the customer's next bubble is already queued → that job answers the whole burst.
  if (await yieldsToNewerBurst(row, trigger.sentAt)) {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: 'superseded',
    })
    return { status: 'skipped', reason: 'superseded' }
  }

  const preModel = await runPreModelGates({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    agentId: resolved.agent.id,
  })
  if (!preModel.ok) {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: preModel.skipReason || 'flag_off',
      status: preModel.status,
    })
    if (preModel.status === 'budget_blocked') {
      void notifyAiNoReply({ tenantId: row.tenantId, conversationId: row.conversationId, reason: 'budget_blocked' })
    }
    return { status: 'skipped', reason: preModel.skipReason || preModel.status }
  }

  // F1: no suggestion mode — a channel that is not activated (Activar) never reaches the model: no provider
  // call, no cost, no customer text sent to an AI. The team is alerted only when the channel WAS activated and
  // the activation went stale (agent or model changed), never for channels nobody turned on.
  if (resolved.agent.operationMode !== 'ai_full' || !resolved.unlockedForSend) {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: 'not_activated',
    })
    if (await channelHasActivationRecord(row.tenantId, row.socialAccountId)) {
      void notifyAiNoReply({ tenantId: row.tenantId, conversationId: row.conversationId, reason: 'not_activated' })
    }
    return { status: 'skipped', reason: 'not_activated' }
  }

  // agents2-hours: "Horario de atención" of this agent (off = 24/7, nothing changes).
  const hoursSetup = await loadHoursSetup(row.tenantId, resolved.agent.id)
  const hours = afterHoursState(hoursSetup.hours, new Date(), { aiDisclosure: hoursSetup.aiDisclosure })

  // Reuse persisted output on lease reclaim (exactly-once contentHash).
  const existing = await prisma.chatAgentTurn.findUnique({
    where: { automationDeliveryKey: row.deliveryKey },
  })
  if (
    existing?.outputText &&
    existing.status === 'generated' &&
    existing.outputHash
  ) {
    const reclaimed = readOutcomeMarkers(existing.decisionTrace)
    const fallbackUsed = existing.fallbackUsed || reclaimed?.fallbackUsed === true
    const needsHuman = reclaimed ? reclaimed.needsHuman : true
    // B1: a planned text (answer, safe line or hand-off text) reaches the same outcome on lease reclaim.
    const planned = reclaimed?.planned === true
    const reclaimedHandoff: TurnHandoff | null =
      planned && reclaimed?.handoffKind ? { kind: reclaimed.handoffKind, reason: reclaimed.handoffReason || 'review' } : null
    // N8: replyBy on the reclaimed send — the turn row says whether code wrote this text.
    const reclaimedCodeDecided = await turnWasCodeDecided(row.tenantId, resolved.agent.id, existing)
    return finishDeliveryOrSuggest({
      plannedReply: planned,
      codeDecided: reclaimedCodeDecided,
      handoff: reclaimedHandoff,
      // Burst = one reply: the photo review planned on the first attempt is settled on reclaim too.
      burstReview: burstReviewIn(existing.decisionTrace),
      persistedMode,
      row,
      payload,
      conversation,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      trigger,
      agentMode,
      effectiveBehavior: behaviorForOperationMode(resolved.agent.operationMode),
      unlockedForSend: resolved.unlockedForSend,
      turnId: existing.id,
      afterHours: hours,
      outputText: existing.outputText,
      outputHash: existing.outputHash,
      outputValidationOk:
        planned ||
        (reclaimed != null &&
          !needsHuman &&
          !fallbackUsed &&
          validateAgentOutput({
            text: existing.outputText,
            citedToolNames: [],
            shippingAmounts: [],
          }).ok),
      toolTrace: existing.toolTrace,
      usage: {
        inputTokens: existing.inputTokens,
        cachedInputTokens: existing.cachedInputTokens,
        outputTokens: existing.outputTokens,
        reasoningTokens: existing.reasoningTokens,
        estimatedCostMicros: existing.estimatedCostMicros,
        latencyMs: existing.latencyMs,
        fallbackUsed,
      },
      needsHuman,
      fallbackUsed,
      escalate: reclaimed?.escalate === true,
    })
  }

  const canal = await loadCanalContextForAccount({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    fallbackPlatform: payload.platform || 'whatsapp',
  })

  const { history, messageTypeOf, loadedRows } = await loadHistory(row.conversationId, trigger.id)
  const liveInventoryIds = await loadMappedInventoryIds(row.tenantId, resolved.agent.id)
  // Burst = one reply: the customer's earlier unanswered bubbles of this burst (photos / audios included).
  const windowBurst = unansweredBurst(
    history.map((m) => ({ ...m, messageType: messageTypeOf.get(m.id) ?? null })),
    trigger,
  )
  // A burst longer than the history window (24+ bubbles): every bubble is still checked (loaded on its own).
  const burstEarlier = burstOutgrowsWindow({ loadedRows, windowMax: HISTORY_WINDOW_MAX, history, burst: windowBurst })
    ? unansweredBurst(
        await loadUnansweredInbound({
          tenantId: row.tenantId,
          conversationId: row.conversationId,
          triggerMessageId: trigger.id,
          triggerSentAt: trigger.sentAt,
        }),
        trigger,
      )
    : windowBurst
  // Burst = one reply (Verifier r2 #2): a bubble sent after this trigger landed since the first check and its job is
  // queued → that job answers the whole burst (and takes any hand-off in it), never this one and then that one too.
  if (burstHasLaterBubble(burstEarlier, trigger) && (await yieldsToNewerBurst(row, trigger.sentAt))) {
    await persistSkippedTurn({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      deliveryKey: row.deliveryKey,
      skipReason: 'superseded',
    })
    return { status: 'skipped', reason: 'superseded' }
  }
  // B6: only a photo / file / audio (here or earlier in the burst) needs the sale's state before the decision.
  const mediaSalesContext =
    isMediaLikeMessageType(trigger.messageType) || burstEarlier.some((m) => isMediaLikeMessageType(m.messageType))
    ? await loadAgentSalesContext({
        tenantId: row.tenantId,
        agentId: resolved.agent.id,
        inventoryItemIds: liveInventoryIds,
        brandFacts: resolved.agent.brandFacts,
      })
    : null
  const shortcuts = await listRuntimeShortcuts(row.tenantId, resolved.agent.id)
  const replyAssets = await loadReplyAssets(row.tenantId, resolved.agent.id)
  // Only replies whose image would really go out are marked "(va con imagen)" (WhatsApp / Instagram, not yet sent in this chat).
  const liveImageReplyIds =
    imageChannel(payload.platform) && replyAssets.size
      ? sendableImageReplyIds(replyAssets, await loadSentAgentImageShas(row.tenantId, row.conversationId))
      : new Set<string>()
  // "Que costo tiene" + photo: the text is answered, a person still looks at the photo (a receipt keeps its path).
  const burst = planBurstInbound({
    trigger: { content: payload.content || '', messageType: trigger.messageType, sentAt: trigger.sentAt },
    earlier: burstEarlier,
    awaitingReceipt: (type) => mediaAwaitingReceipt(type, history, mediaSalesContext),
  })
  const { decision, burstReview } = decideBurstTurn({
    burst,
    burstEarlier,
    trigger: { content: payload.content || '', messageType: trigger.messageType },
    history,
    mediaSalesContext,
    earlierCustomerTexts: earlierCustomerTexts(history),
    decisionBase: {
      brandFacts: resolved.agent.brandFacts,
      replyStyle: resolved.agent.replyStyle,
      shortcuts,
      // A keyword reply WITH images whose image can't go out now ("Te paso la guía 👇" with nothing) → model answers.
      skipVerbatimIds: new Set([...replyAssets.keys()].filter((id) => !liveImageReplyIds.has(id))),
      awaitingPaymentMethod: awaitingPaymentMethodChoice(history),
    },
  })
  decision.decisionTrace.historyCount = history.length

  if (decision.handled) {
    // B1: code plans what goes out (its own text, or the safe line when it failed a check) — never a silent draft.
    const plan = applySafeLineCap(
      planDecisionDelivery({ text: decision.text, textOk: decision.textOk, handoff: decision.handoff }),
      await safeLineSentRecently(row.tenantId, row.conversationId, row.deliveryKey),
    )
    const handledText = withNightIntro(finalizePlannedText(plan, payload, trigger.sentAt, hours), hours, nightIntroWho(resolved.agent, history))
    const outputHash = hashSoftAiOutput(handledText)
    const handledMarkers: OutcomeMarkers = plannedMarkers(
      { needsHuman: decision.needsHuman, fallbackUsed: false, escalate: decision.escalate },
      plan.handoff,
    )
    const trace = redactAgentTrace(
      withOutcomeMarkers(decision.decisionTrace, handledMarkers),
      resolved.agent.brandFacts,
    )
    const turn = await prisma.chatAgentTurn.upsert({
      where: { automationDeliveryKey: row.deliveryKey },
      create: {
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        socialAccountId: row.socialAccountId,
        agentId: resolved.agent.id,
        bindingId: resolved.binding.id,
        triggerMessageId: row.messageId,
        automationDeliveryKey: row.deliveryKey,
        mode:
          resolved.effectiveBehavior === 'send'
            ? 'ai_full'
            : resolved.effectiveMode === 'ai_full'
              ? 'ai_full'
              : 'ai_suggest',
        model: resolved.agent.model,
        agentVersion: resolved.agent.version,
        status: 'generated',
        outputText: handledText,
        outputHash,
        toolTrace: trace as Prisma.InputJsonValue,
        decisionTrace: trace as Prisma.InputJsonValue,
        shortcutKey: decision.shortcutKey,
        intent: decision.intent,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        estimatedCostMicros: BigInt(0),
        pricingVersion: pricingVersionFor(resolved.agent.model),
        latencyMs: 0,
        fallbackUsed: false,
        errorCode: decision.escalate ? decision.shortcutKey : null,
      },
      update: {
        // A re-armed (swept) message reuses its skipped row: bill it today, to the agent that answers now (Verifier F1).
        ...rebillTurnFields({ agentId: resolved.agent.id, bindingId: resolved.binding.id, model: resolved.agent.model, agentVersion: resolved.agent.version }),
        status: 'generated',
        outputText: handledText,
        outputHash,
        toolTrace: trace as Prisma.InputJsonValue,
        decisionTrace: trace as Prisma.InputJsonValue,
        shortcutKey: decision.shortcutKey,
        intent: decision.intent,
        errorCode: decision.escalate ? decision.shortcutKey : null,
      },
    })
    // Burst = one reply: the customer's next bubble arrived meanwhile → the newer job answers everything.
    if (await yieldsToNewerBurst(row, trigger.sentAt, plan.handoff, 'pre_send')) return markTurnSuperseded(row, turn.id)
    // B1: no flip here. The hand-off text goes out first through every gate (pre-flip mode); finishDeliveryOrSuggest
    // then moves the chat to a person and notifies (also when the send is blocked).
    return finishDeliveryOrSuggest({
      plannedReply: true,
      codeDecided: true,
      handoff: plan.handoff,
      burstReview,
      suppressSend: plan.suppressSend,
      persistedMode,
      row,
      payload,
      conversation,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      trigger,
      agentMode,
      effectiveBehavior: behaviorForOperationMode(resolved.agent.operationMode),
      unlockedForSend: resolved.unlockedForSend,
      turnId: turn.id,
      outputText: handledText,
      outputHash,
      // Planned text: the decision's own text only when it passed the checks, otherwise the reserved safe line.
      outputValidationOk: true,
      toolTrace: trace,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        estimatedCostMicros: BigInt(0),
        latencyMs: 0,
        fallbackUsed: false,
      },
      needsHuman: decision.needsHuman,
      fallbackUsed: false,
      escalate: decision.escalate,
      replyShortcutKey: decision.shortcutKey,
      shortcuts,
      replyAssets,
      startedAt: turnStartedAt,
      afterHours: hours,
    })
  }

  const knowledge = await loadApprovedKnowledgeForAgent({
    tenantId: row.tenantId,
    agentId: resolved.agent.id,
    socialAccountId: row.socialAccountId,
  })

  const runtimeInput = assembleAgentRuntimeInputs({
    agent: resolved.agent,
    account: canal,
    history,
    inboundText: burst.inboundText,
    clientName: conversation.peerName,
    shortcuts,
    replyImageShortcutIds: liveImageReplyIds,
    knowledge,
    decision,
    afterHoursLine: afterHoursPromptLine(hours),
    salesContext: await loadAgentSalesContext({
      tenantId: row.tenantId,
      agentId: resolved.agent.id,
      inventoryItemIds: liveInventoryIds,
      brandFacts: resolved.agent.brandFacts,
    }),
    toolCtxBase: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      peerId: row.peerId,
      clientId: conversation.clientId,
      inventoryItemIds: liveInventoryIds,
      orderOwnership: (await loadAgentSettings(row.tenantId, resolved.agent.id)).orderOwnership,
      platform: payload.platform || 'whatsapp',
    },
  })
  const llm = await runSoftAiLlmRuntime(runtimeInput)

  const policy = applyFinalOutputPolicy({
    text: llm.text,
    intent: llm.intent || decision.intent,
    citedToolNames: llm.citedToolNames,
    inventoryPrices: llm.inventoryPrices,
    quoteAmounts: runtimeInput.salesAllowedAmounts,
    skipPurchaseSummary: Boolean(runtimeInput.salesTurnBlock),
    // SecureDog round 6: the whole burst since the store last wrote ("Estoy embarazada" + "¿Lo puedo usar?").
    customerText: burstCustomerText(history, burst.inboundText),
    allowedDeals: runtimeInput.salesAllowedDeals,
    freeShipping: runtimeInput.salesFreeShipping,
    freeShippingRule: runtimeInput.salesFreeShippingRule,
    brandFacts: resolved.agent.brandFacts,
    replyStyle: resolved.agent.replyStyle,
    shortcuts,
    shortenLongReply: true,
    linkAllowlist: runtimeInput.linkAllowlist,
    // Verifier round 4: "pasame los datos" … "gracias" — every customer message since the store last answered.
    paymentOptions: { ...runtimeInput.salesPaymentOptions, customerText: customerTextSinceLastAnswer(history, burst.inboundText) },
  })
  const needsHuman = policy.needsHuman || llm.needsHuman || runtimeInput.salesNeedsHuman === true
  // B1: what goes out is planned by code: the model reply (checked), the safe line, or the hand-off text.
  const modelPlan = applySafeLineCap(
    planModelTurnDelivery({
      text: policy.text,
      textOk: llm.textOk && !policy.needsHuman,
      llmHandoff: llm.handoff,
      llmEscalateReason: llm.handoff?.kind === 'handoff' ? llm.escalateReason : null,
      receiptCue: runtimeInput.salesReceiptCue === true,
      paymentDataByTeam: runtimeInput.salesPaymentDataByTeam === true,
      codOrderReady: policy.paymentMethods.some((m) => m === 'contra_entrega' || m === 'efectivo'),
      orderReadyCash: policy.paymentMethods.includes('efectivo'),
    }),
    await safeLineSentRecently(row.tenantId, row.conversationId, row.deliveryKey),
  )
  const finalText = withNightIntro(finalizePlannedText(modelPlan, payload, trigger.sentAt, hours), hours, nightIntroWho(resolved.agent, history))
  const modelMarkers: OutcomeMarkers = plannedMarkers(
    { needsHuman, fallbackUsed: llm.fallbackUsed, escalate: llm.escalate },
    modelPlan.handoff,
  )
  const modelTrace = redactAgentTrace(
    withOutcomeMarkers(
      {
        ...decision.decisionTrace,
        salesState: runtimeInput.salesTrace ?? null,
        validator: policy.reasons,
        highlightedAmounts: policy.highlightedAmounts,
        purchaseSummaryAppended: policy.purchaseSummaryAppended,
        escalateKind: llm.escalateKind,
        // The held model reply stays only in the redacted trace (the customer got the planned text).
        ...(modelPlan.text !== policy.text ? { heldModelText: policy.text.slice(0, 1_000) } : {}),
      },
      modelMarkers,
    ),
    resolved.agent.brandFacts,
  )
  const outputHash = hashSoftAiOutput(finalText)
  const turn = await prisma.chatAgentTurn.upsert({
    where: { automationDeliveryKey: row.deliveryKey },
    create: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      agentId: resolved.agent.id,
      bindingId: resolved.binding.id,
      triggerMessageId: row.messageId,
      automationDeliveryKey: row.deliveryKey,
      mode:
        resolved.effectiveBehavior === 'send'
          ? 'ai_full'
          : resolved.effectiveMode === 'ai_full'
            ? 'ai_full'
            : 'ai_suggest',
      model: resolved.agent.model,
      agentVersion: resolved.agent.version,
      status: 'generated',
      outputText: finalText,
      outputHash,
      toolTrace: redactAgentTrace(llm.toolTrace, resolved.agent.brandFacts) as Prisma.InputJsonValue,
      decisionTrace: modelTrace as Prisma.InputJsonValue,
      shortcutKey: policy.purchaseSummaryAppended
        ? 'sys_purchase_summary'
        : llm.shortcutKey || null,
      intent: policy.intent,
      inputTokens: llm.inputTokens,
      cachedInputTokens: llm.cachedInputTokens,
      outputTokens: llm.outputTokens,
      reasoningTokens: llm.reasoningTokens,
      estimatedCostMicros: BigInt(llm.estimatedCostMicros),
      pricingVersion: pricingVersionFor(resolved.agent.model),
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
      errorCode: llm.errorCode || (needsHuman ? policy.reasons[0] || null : null),
    },
    update: {
      // Re-armed (swept) message: its row was created when it was skipped — bill these tokens today, to this agent (F1).
      ...rebillTurnFields({ agentId: resolved.agent.id, bindingId: resolved.binding.id, model: resolved.agent.model, agentVersion: resolved.agent.version }),
      status: 'generated',
      outputText: finalText,
      outputHash,
      toolTrace: redactAgentTrace(llm.toolTrace, resolved.agent.brandFacts) as Prisma.InputJsonValue,
      decisionTrace: modelTrace as Prisma.InputJsonValue,
      shortcutKey: policy.purchaseSummaryAppended
        ? 'sys_purchase_summary'
        : llm.shortcutKey || null,
      intent: policy.intent,
      inputTokens: llm.inputTokens,
      cachedInputTokens: llm.cachedInputTokens,
      outputTokens: llm.outputTokens,
      reasoningTokens: llm.reasoningTokens,
      estimatedCostMicros: BigInt(llm.estimatedCostMicros),
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
      errorCode: llm.errorCode || null,
    },
  })

  // Burst = one reply: a bubble arrived while the model wrote → the newer job answers the whole burst instead.
  if (await yieldsToNewerBurst(row, trigger.sentAt, modelPlan.handoff, 'pre_send')) return markTurnSuperseded(row, turn.id)
  // B1: no flip before the send (the old flip made the pre-send re-read skip → silent draft). See finishDeliveryOrSuggest.
  return finishDeliveryOrSuggest({
    plannedReply: true,
    handoff: modelPlan.handoff,
    burstReview,
    suppressSend: modelPlan.suppressSend,
    persistedMode,
    row,
    payload,
    conversation,
    agent: resolved.agent,
    bindingId: resolved.binding.id,
    trigger,
    agentMode,
    effectiveBehavior: behaviorForOperationMode(resolved.agent.operationMode),
    unlockedForSend: resolved.unlockedForSend,
    turnId: turn.id,
    outputText: finalText,
    outputHash,
    // Planned text: the model reply only when every check passed, otherwise a reserved line.
    outputValidationOk: true,
    toolTrace: modelTrace,
    usage: {
      inputTokens: llm.inputTokens,
      cachedInputTokens: llm.cachedInputTokens,
      outputTokens: llm.outputTokens,
      reasoningTokens: llm.reasoningTokens,
      estimatedCostMicros: BigInt(llm.estimatedCostMicros),
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
    },
    needsHuman,
    fallbackUsed: llm.fallbackUsed,
    escalate: llm.escalate,
    // A planned safe line / hand-off text carries no images (input.handoff is set): see the image block.
    replyShortcutKey: policy.purchaseSummaryAppended ? null : llm.shortcutKey || null,
    shortcuts,
    replyAssets,
    startedAt: turnStartedAt,
    afterHours: hours,
  })
}

function persistedTurnStatus(outcome: AgentTurnOutcome, gateStatus?: string): string {
  if (outcome.outcome === 'suggest') return 'suggested'
  if (gateStatus === 'window_closed' || gateStatus === 'budget_blocked' || gateStatus === 'fallback') {
    return gateStatus
  }
  return 'skipped'
}

async function persistDecidedTurn(input: {
  turnId: string
  outcome: AgentTurnOutcome
  operationMode: string
  gateStatus?: string
  setMode: boolean
}): Promise<AgentTurnDispatchResult> {
  const status = persistedTurnStatus(input.outcome, input.gateStatus)
  await prisma.chatAgentTurn.update({
    where: { id: input.turnId },
    data: {
      status,
      skipReason: input.outcome.reason,
      ...(input.setMode
        ? { mode: input.operationMode === 'ai_full' ? 'ai_full' : 'ai_suggest' }
        : {}),
      completedAt: new Date(),
    },
  })
  if (input.outcome.outcome === 'suggest') return { status: 'suggested', turnId: input.turnId }
  return { status: 'skipped', reason: input.outcome.reason || input.gateStatus }
}

/**
 * B1 hand-off settlement, AFTER the text went out (or was blocked): a TRUE hand-off moves the chat to a person
 * (never over 'paused') and notifies; a review only notifies (chat stays on IA). Never throws.
 */
async function settleHandoff(row: ClaimedChatAutomationJob, handoff: TurnHandoff, afterHours: AfterHoursState = IN_HOURS): Promise<void> {
  try {
    if (handoff.kind === 'handoff') {
      await prisma.chatConversation.updateMany({
        where: { id: row.conversationId, tenantId: row.tenantId, OR: [{ aiMode: null }, { aiMode: { not: 'paused' } }] },
        data: { aiMode: 'human' },
      })
    }
    await notifyHandoff({
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      kind: handoff.kind,
      reason: handoff.reason,
      // agents2-hours: created now (the queue is ready in the morning) but quiet until the team is back.
      quietUntil: afterHours.afterHours ? afterHours.opensAt : null,
    })
  } catch (error) {
    console.error('[soft-ai handoff]', { code: error instanceof Error ? error.name : 'error' })
  }
}

/** Delivery decision + "La IA no respondió" alert when an agent that should answer stays silent. */
async function finishDeliveryOrSuggest(
  input: Parameters<typeof finishDeliveryOrSuggestInner>[0],
): Promise<AgentTurnDispatchResult> {
  let result: AgentTurnDispatchResult
  try {
    result = await finishDeliveryOrSuggestInner(input)
  } finally {
    // Also when the send threw or was blocked (window / token / kill switch): the person must still get the chat.
    if (input.handoff) await settleHandoff(input.row, input.handoff, input.afterHours)
    // Burst = one reply: a photo / audio, or another bubble's review ("¿Cómo pago?" → payment_details), still needs a
    // person after the answered text (review, the chat stays on IA). Kept apart from `handoff` so the normal reply
    // keeps its images and the repeat guard.
    else if (input.burstReview) {
      await settleHandoff(input.row, input.burstReview, input.afterHours)
    }
  }
  // F2: part of the reply did not go out (ambiguous send / kill switch / chat taken): a person is asked to look
  // (review alert, the chat stays as it is). Only the parts actually sent were written as messages.
  if (!input.handoff && !input.burstReview && result.status === 'delivered' && result.partialDelivery) {
    await settleHandoff(input.row, { kind: 'review', reason: HANDOFF_REASON.review }, input.afterHours)
  }
  // notifyHandoff already told the team: no second "La IA no respondió" alert.
  // A burst photo review alone does not say the customer got no reply: that alert still goes out.
  if (!input.handoff && (result.status === 'suggested' || result.status === 'skipped')) {
    const turn = await prisma.chatAgentTurn.findUnique({ where: { id: input.turnId }, select: { skipReason: true } })
    void notifyAiNoReply({ tenantId: input.row.tenantId, conversationId: input.row.conversationId, reason: turn?.skipReason })
  }
  return result
}

async function finishDeliveryOrSuggestInner(input: {
  row: ClaimedChatAutomationJob
  payload: JobPayload
  conversation: {
    id: string
    aiMode: string | null
    clientId: string | null
    lastInboundAt: Date | null
    peerId: string
    peerName: string | null
    socialAccountId: string
  }
  agent: ResolvedChatAgent
  bindingId: string
  trigger: { id: string; sentAt: Date; providerMessageId?: string | null }
  agentMode: string | null
  effectiveBehavior: EffectiveAgentBehavior
  unlockedForSend: boolean
  turnId: string
  /** Burst = one reply: a review the answered burst still owes → settled after the send (inbound-burst.ts). */
  burstReview?: TurnHandoff | null
  outputText: string
  outputHash: string
  outputValidationOk: boolean
  toolTrace: unknown
  usage: {
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningTokens: number
    estimatedCostMicros: bigint | number
    latencyMs: number | null
    fallbackUsed: boolean
  }
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
  /** Saved reply this answer used: its images go out first (WhatsApp; never twice in the chat). */
  replyShortcutKey?: string | null
  shortcuts?: RuntimeShortcut[]
  replyAssets?: Map<string, AgentAsset[]>
  /** When the job started: images are skipped once the turn is late (the job times out at 42 s). */
  startedAt?: number
  /** B1: the text was planned by code (never a silent draft for needsHuman / fallback / escalate). */
  plannedReply?: boolean
  /** B1: hand-off / review settled after the send (finishDeliveryOrSuggest). */
  handoff?: TurnHandoff | null
  /** B1 loop cap: the safe line already went out recently — send nothing, the chat goes to a person. */
  suppressSend?: boolean
  /** agentState mode for this chat (null-column chats re-resolve with the line at the pre-send re-read). */
  persistedMode?: SoftAiAgentMode | null
  /** The text was decided by code before the model (keyword saved reply / system message): "Corregir" points to Respuestas guardadas. */
  codeDecided?: boolean
  /** agents2-hours: this turn is outside the agent's "Horario de atención" (hand-off alerts are quiet until it opens). */
  afterHours?: AfterHoursState
}): Promise<AgentTurnDispatchResult> {
  const decisionBase = {
    effectiveBehavior: input.effectiveBehavior,
    unlockedForSend: input.unlockedForSend,
    needsHuman: input.needsHuman,
    fallbackUsed: input.fallbackUsed || input.usage.fallbackUsed,
    escalate: input.escalate,
    plannedReply: input.plannedReply === true,
  }
  if (input.suppressSend) {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: { outcome: 'skip', reason: 'safe_line_repeat' },
      operationMode: input.agent.operationMode,
      setMode: false,
    })
  }
  // Kill switch armed or AI terms revoked while this turn was running: nothing is suggested or sent.
  // (The suggest path never reaches runPreSendGates, so both are re-checked here.)
  if ((await readAgentKillState(input.row.tenantId)).armed) {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: { outcome: 'skip', reason: 'kill_switch' },
      operationMode: input.agent.operationMode,
      setMode: false,
    })
  }
  if (!(await isAiTermsAcceptedNow(input.row.tenantId))) {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: { outcome: 'skip', reason: 'ai_terms_not_accepted' },
      operationMode: input.agent.operationMode,
      setMode: false,
    })
  }
  // Never send (or suggest) an empty message: skipped with a reason, so the "La IA no respondió" alert fires.
  if (!input.outputText.trim()) {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: { outcome: 'skip', reason: 'empty_output' },
      operationMode: input.agent.operationMode,
      setMode: false,
    })
  }
  const first = decideTurnOutcome({
    ...decisionBase,
    conversationAiMode: normalizeConversationAiMode(input.agentMode),
    gateBlockers: [],
  })
  if (first.outcome !== 'send') {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: first,
      operationMode: input.agent.operationMode,
      setMode: first.outcome === 'suggest',
    })
  }

  // Re-read conversation mode immediately before send.
  const fresh = await prisma.chatConversation.findFirst({
    where: { id: input.row.conversationId, tenantId: input.row.tenantId },
    select: { aiMode: true, lastInboundAt: true },
  })
  const columnNow = normalizeConversationAiMode(fresh?.aiMode)
  // A chat with no mode follows its line (same rule as the start of the turn), re-checked right before the send.
  const lineOn = input.effectiveBehavior === 'send' && input.unlockedForSend
  const modeNow =
    columnNow ??
    effectiveConversationAiMode({
      column: null,
      persisted: input.persistedMode ?? null,
      lineOn,
      humanWroteRecently: lineOn ? await humanWroteRecently(input.row.tenantId, input.row.conversationId) : false,
    }).mode
  let gateStatus: string | undefined
  let gateBlockers: string[] = []
  if (maySoftAiMetaReply(modeNow)) {
    const preSend = await runPreSendGates({
      tenantId: input.row.tenantId,
      socialAccountId: input.row.socialAccountId,
      conversationId: input.row.conversationId,
      triggerSentAt: input.trigger.sentAt,
      agentId: input.agent.id,
      expectedVersion: input.agent.version,
      platform: input.payload.platform || 'whatsapp',
      lastInboundAt: fresh?.lastInboundAt || input.conversation.lastInboundAt,
      conversationAiMode: modeNow,
      operationMode: input.agent.operationMode,
      unlockedRequired: true,
      outputValidationOk: input.outputValidationOk,
    })
    if (!preSend.ok) {
      gateStatus = preSend.status
      gateBlockers = [preSend.skipReason || preSend.status]
    }
  }

  const second = decideTurnOutcome({
    ...decisionBase,
    conversationAiMode: modeNow,
    gateBlockers,
  })
  if (second.outcome !== 'send') {
    return persistDecidedTurn({
      turnId: input.turnId,
      outcome: second,
      operationMode: input.agent.operationMode,
      gateStatus,
      setMode: false,
    })
  }

  const account = await prisma.socialAccount.findFirst({
    where: { id: input.row.socialAccountId, tenantId: input.row.tenantId },
    select: {
      accessToken: true,
      refreshToken: true,
      accountId: true,
      pageId: true,
      platform: true,
    },
  })
  const denyUnhealthyToken = () =>
    persistDecidedTurn({
      turnId: input.turnId,
      outcome: decideTurnOutcome({
        ...decisionBase,
        conversationAiMode: modeNow,
        gateBlockers: ['token_unhealthy'],
      }),
      operationMode: input.agent.operationMode,
      setMode: false,
    })
  if (!account?.accessToken) return denyUnhealthyToken()
  const accessToken = decryptSocialAccessToken(account.accessToken)
  if (!accessToken) return denyUnhealthyToken()
  const meta = parseSocialRefreshToken(account.refreshToken)

  // luna-10 #5: never repeat what the chat got in the last 20 minutes (repeat-guard.ts). This job's own earlier
  // sends are not "earlier" (lease reclaim must re-plan the same parts). Hand-offs / safe lines are code texts with
  // their own caps and pass unchanged.
  let outgoingText = input.outputText
  let repeatAllDropped = false
  if (!input.handoff && !input.escalate && !input.needsHuman) {
    const recent = await prisma.chatMessage.findMany({
      where: {
        tenantId: input.row.tenantId,
        conversationId: input.row.conversationId,
        direction: { in: ['outbound', 'inbound'] },
        sentAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
      },
      select: { content: true, metadata: true, direction: true },
      orderBy: { sentAt: 'desc' },
      take: 40,
    })
    const previous = recent
      .filter((m) => m.direction === 'outbound' && (m.metadata as { automationJobId?: unknown } | null)?.automationJobId !== input.row.id)
      .map((m) => m.content || '')
      .filter(Boolean)
    // Verifier round 3: everything the customer wrote since the store last answered ("y a Limón" … "cuánto sale?").
    const sinceLastAnswer: string[] = []
    for (const m of recent) {
      if (m.direction === 'outbound' && (m.metadata as { automationJobId?: unknown } | null)?.automationJobId !== input.row.id) break
      if (m.direction === 'inbound' && m.content) sinceLastAnswer.push(m.content)
    }
    const customerText = [...sinceLastAnswer.reverse(), input.payload.content || ''].join('\n')
    const repeat = dropRepeatedParts({ text: input.outputText, previous, customerText })
    if (repeat.dropped.length && repeat.kept.length) {
      outgoingText = repeat.kept.join('\n\n')
    } else if (repeat.dropped.length) {
      // Everything was already said: the customer is not getting what they need — a person looks, never a re-run.
      void notifyHandoff({ tenantId: input.row.tenantId, conversationId: input.row.conversationId, socialAccountId: input.row.socialAccountId, kind: 'review', reason: 'review' })
      if (await safeLineSentRecently(input.row.tenantId, input.row.conversationId, input.row.deliveryKey)) {
        return persistDecidedTurn({ turnId: input.turnId, outcome: { outcome: 'skip', reason: 'duplicate_reply' }, operationMode: input.agent.operationMode, setMode: false })
      }
      outgoingText = input.afterHours?.afterHours ? afterHoursReviewLine(input.afterHours.label, input.afterHours.transparent) : SAFE_LINE.review
      repeatAllDropped = true
    }
    // Verifier F4: the turn row holds what really goes out (the safe-line cap and Corregir read it).
    if (outgoingText !== input.outputText) {
      await prisma.chatAgentTurn.update({
        where: { id: input.turnId },
        data: { outputText: outgoingText, outputHash: hashSoftAiOutput(outgoingText) },
      })
    }
  }

  // Images of the saved reply first (like a person sending the size guide, then the text). Code picks them.
  const platform = input.payload.platform || 'whatsapp'
  const textAlreadyClaimed = await prisma.chatAutomationDelivery
    .findUnique({ where: { jobId_deliveryKey: { jobId: input.row.id, deliveryKey: input.row.deliveryKey } }, select: { id: true } })
    .then(Boolean)
  // A re-run of a job whose text was already attempted sends no new images (they belong to that first answer).
  if (!textAlreadyClaimed && ((platform === 'whatsapp' && account.accountId) || platform === 'instagram') && input.outputText && !input.escalate && !input.handoff && input.replyAssets?.size && !repeatAllDropped) {
    const pick = selectReplyImages({
      shortcutKey: input.replyShortcutKey,
      shortcuts: input.shortcuts ?? [],
      assetsByShortcut: input.replyAssets,
      alreadySent: await loadSentAgentImageShas(input.row.tenantId, input.row.conversationId),
    })
    const byId = new Map([...input.replyAssets.values()].flat().map((a) => [a.id, a]))
    const assets = pick.images.map((img) => byId.get(img.assetId)).filter((a): a is AgentAsset => Boolean(a))
    if (assets.length) {
      await sendAgentImagesOnce(
        {
          job: {
            id: input.row.id,
            deliveryKey: input.row.deliveryKey,
            tenantId: input.row.tenantId,
            socialAccountId: input.row.socialAccountId,
            peerId: input.row.peerId,
            messageId: input.row.messageId,
          },
          platform: platform === 'instagram' ? 'instagram' : 'whatsapp',
          phoneNumberId: account.accountId || '',
          pageId: account.pageId || meta.pageId,
          accessToken,
          agent: { id: input.agent.id, version: input.agent.version, name: input.agent.name, emoji: input.agent.emoji },
          turnId: input.turnId,
          peerName: input.payload.senderName || input.conversation.peerName || null,
          deadlineAt: (input.startedAt ?? Date.now()) + AGENT_IMAGE_DEADLINE_MS,
        },
        assets,
      )
    }
  }

  // agents2-format: the reply goes out as up to 3 messages (one per paragraph), in order, each claimed exactly once.
  const partsPlan = planReplyParts({ text: outgoingText, deliveryKey: input.row.deliveryKey, hash: hashSoftAiDeliveryContent })
  const partsDeadlineAt = (input.startedAt ?? Date.now()) + AGENT_PARTS_DEADLINE_MS
  // agents2-pace: "Velocidad de respuesta" — a typing wait before each message; the time since the customer wrote
  // (model included) counts. A re-run of a job whose text was already attempted goes out at once (no new waits).
  const paceSetup = textAlreadyClaimed ? { pace: 'instant' as const, typing: false } : await loadPaceSetup(input.row.tenantId, input.agent.id)
  const replyPace: ReplyPace = paceSetup.pace
  const showTyping = replyPace !== 'instant' && platform === 'whatsapp' && paceSetup.typing
  let pacedSoFarMs = 0
  let lastSentAt = input.trigger.sentAt.getTime()
  let firstSkipped = false
  let partial = false
  for (let i = 0; i < partsPlan.length; i += 1) {
    let part = partsPlan[i]
    let lastPart = i === partsPlan.length - 1
    if (i > 0) {
      // The kill switch was armed, or a person took / paused the chat, while the reply was going out: stop here.
      if (await stopRemainingParts(input.row.tenantId, input.row.conversationId)) {
        partial = true
        break
      }
    }
    const now = Date.now()
    const wait = planPartWait({
      pace: replyPace,
      index: i,
      chars: part.text.length,
      now,
      spentMs: now - lastSentAt,
      pacedSoFarMs,
      deadlineAt: partsDeadlineAt,
    })
    if (wait.late) {
      // Late turn (F2): everything left goes out NOW as one last message (never silently dropped).
      part = remainderPart(partsPlan, i, hashSoftAiDeliveryContent)
      lastPart = true
    } else if (wait.waitMs > 0) {
      const waitUntil = now + wait.waitMs
      // WhatsApp "escribiendo…" (best effort, ≤ 2 s, inside the wait — never adds time).
      if (showTyping) {
        await sendWhatsappTypingIndicator({ accessToken, phoneNumberId: account.accountId, inboundMessageId: input.trigger.providerMessageId })
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, waitUntil - Date.now())))
      pacedSoFarMs += wait.waitMs
      // Gate re-check after the wait: kill switch / a person took or paused the chat meanwhile.
      if (i === 0) {
        const stop = await pacedFirstPartStop(input.row.tenantId, input.row.conversationId, input.trigger.sentAt)
        if (stop) {
          return persistDecidedTurn({ turnId: input.turnId, outcome: { outcome: 'skip', reason: stop }, operationMode: input.agent.operationMode, setMode: false })
        }
      } else if (
        (await stopRemainingParts(input.row.tenantId, input.row.conversationId)) ||
        (await humanRepliedSinceTrigger(input.row.conversationId, input.trigger.sentAt))
      ) {
        partial = true
        break
      }
    }
    let delivery: { skipped: boolean; providerDeliveryId?: string; result?: { providerMessageId?: string } }
    try {
      delivery = await deliverOnce({
        jobId: input.row.id,
        deliveryKey: part.deliveryKey,
        kind: 'text',
        contentHash: part.contentHash,
        send: async () => {
          const result = await sendMetaText({
            platform: input.payload.platform || 'whatsapp',
            accessToken,
            phoneNumberId: account.accountId,
            pageId: account.pageId || meta.pageId,
            recipient: input.row.peerId,
            text: part.text,
          })
          if (!result.ok) {
            throw new Error(
              result.error && /^[A-Z0-9_:-]{3,80}$/i.test(result.error)
                ? result.error.slice(0, 80).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_')
                : 'META_SEND_FAILED',
            )
          }
          return result
        },
        providerDeliveryId: (result) => result.providerMessageId,
      })
    } catch (error) {
      // The first message keeps the old behaviour (the turn fails, nothing was sent). A later part that is ambiguous
      // or failed stops the loop: never resent, the earlier parts stay delivered.
      if (part.index === 0) throw error
      console.error('[soft-ai reply part]', { turnId: input.turnId, part: part.index, code: error instanceof Error ? error.message.slice(0, 60) : 'error' })
      partial = true
      break
    }
    if (part.index === 0) firstSkipped = delivery.skipped
    lastSentAt = Date.now()

    const providerMessageId =
      delivery.providerDeliveryId ||
      (!delivery.skipped ? delivery.result?.providerMessageId : undefined)

    await dualWriteChatMessage({
      tenantId: input.row.tenantId,
      socialAccountId: input.row.socialAccountId,
      direction: 'outbound',
      content: part.text,
      sentAt: new Date(),
      peerId: input.row.peerId,
      peerName: input.payload.senderName || input.conversation.peerName || null,
      providerMessageId: providerMessageId || null,
      messageType: 'text',
      // Marks the team reply only up to the customer message this turn answered.
      answersMessageId: input.row.messageId,
      deliveryStatus: 'sent',
      platform: input.payload.platform || 'whatsapp',
      metadata: {
        softAi: true,
        agentId: input.agent.id,
        agentVersion: input.agent.version,
        // Snapshot at send time. /chats labels this bubble from these fields, not the live binding.
        agentName: input.agent.name,
        agentEmoji: input.agent.emoji,
        turnId: input.turnId,
        // The trace once per turn (first message), not copied onto every part.
        ...(part.index === 0 ? { toolTrace: input.toolTrace } : {}),
        to: input.row.peerId,
        platform: input.payload.platform,
        providerMessageId,
        automationJobId: input.row.id,
        deliverySkipped: delivery.skipped,
        // "Corregir" (agent-tuning.ts): the customer message this answered, and whether code or the agent wrote it.
        answersMessageId: input.row.messageId,
        replyBy: input.codeDecided ? 'code' : 'agent',
        // agents2-format: which message of the reply this is (Corregir joins the parts of one turn).
        partIndex: part.index,
        partCount: lastPart ? part.index + 1 : partsPlan.length,
      },
      suppressSoftAi: true,
    })
    if (lastPart) break
  }

  await prisma.chatAgentTurn.update({
    where: { id: input.turnId },
    data: {
      status: 'delivered',
      skipReason: null,
      completedAt: new Date(),
      // Some parts of the reply did not go out (late turn / ambiguous send): visible in the turn row.
      ...(partial ? { errorCode: 'partial_delivery' } : {}),
    },
  })

  // The IA answered a chat that had no mode: it is now an IA chat (a true hand-off flips it to 'human' right after).
  if (!columnNow && input.handoff?.kind !== 'handoff') {
    await prisma.chatConversation.updateMany({
      where: { id: input.row.conversationId, tenantId: input.row.tenantId, aiMode: null },
      data: { aiMode: 'ai_active' },
    })
  }

  return {
    status: 'delivered',
    turnId: input.turnId,
    skippedDelivery: firstSkipped,
    ...(partial ? { partialDelivery: true } : {}),
  }
}

/**
 * Before each later part of a reply (#7): stop when the kill switch was armed or the chat is no longer the AI's
 * (a person took it or paused it meanwhile). Fail-safe: a read error stops too.
 */
async function stopRemainingParts(tenantId: string, conversationId: string): Promise<boolean> {
  try {
    if ((await readAgentKillState(tenantId)).armed) return true
    const conv = await prisma.chatConversation.findFirst({ where: { id: conversationId, tenantId }, select: { aiMode: true } })
    return !conv || conv.aiMode === 'human' || conv.aiMode === 'paused'
  } catch {
    return true
  }
}

/**
 * agents2-pace: after the typing wait before the FIRST message (nothing sent yet), why not to send it: kill switch,
 * a person took / paused the chat, or a person already answered the customer (same as the pre-send gate).
 * Verifier F3: a read error is never a silent drop — every gate passed seconds before the wait, so the reply goes out.
 */
async function pacedFirstPartStop(tenantId: string, conversationId: string, triggerSentAt: Date): Promise<string | null> {
  try {
    if ((await readAgentKillState(tenantId)).armed) return 'kill_switch'
    const conv = await prisma.chatConversation.findFirst({ where: { id: conversationId, tenantId }, select: { aiMode: true } })
    if (!conv) return 'conversation_missing'
    if (conv.aiMode === 'human') return 'human_before_send'
    if (conv.aiMode === 'paused') return 'paused_before_send'
    if (await hasHumanRepliedAfter({ conversationId, triggerSentAt })) return 'human_replied'
    return null
  } catch (error) {
    console.error('[soft-ai pace recheck]', { code: error instanceof Error ? error.name : 'error' })
    return null
  }
}

/** Verifier F2: a person wrote to the customer during the wait (the AI's own parts are softAi and don't count). */
async function humanRepliedSinceTrigger(conversationId: string, triggerSentAt: Date): Promise<boolean> {
  try {
    return await hasHumanRepliedAfter({ conversationId, triggerSentAt })
  } catch {
    // Fail-safe like stopRemainingParts: stop the remaining parts (partial → a person is asked to review).
    return true
  }
}

/**
 * agents2-hours: this agent's "Horario de atención" (salesRules.businessHours) and its "¿Sos un bot?" setting (the
 * after-hours wording follows it). Never throws; default off (24/7), discreet.
 */
async function loadHoursSetup(tenantId: string, agentId: string): Promise<{ hours: BusinessHours; aiDisclosure: 'transparent' | 'discreet' }> {
  try {
    const rules = (await loadSalesSetup(tenantId, agentId)).salesRules
    // luna-10: the night may be transparent ('asistente virtual') while the day stays discreet.
    return { hours: rules.businessHours ?? DEFAULT_BUSINESS_HOURS, aiDisclosure: rules.afterHoursDisclosure === 'transparent' ? 'transparent' : rules.aiDisclosure }
  } catch {
    return { hours: DEFAULT_BUSINESS_HOURS, aiDisclosure: 'discreet' }
  }
}

/**
 * agents2-pace: this agent's "Velocidad de respuesta" (salesRules.replyPace, default 'natural') and whether WhatsApp
 * shows "escribiendo…" (salesRules.typingIndicator, default on). Never throws.
 */
async function loadPaceSetup(tenantId: string, agentId: string): Promise<{ pace: ReplyPace; typing: boolean }> {
  try {
    const rules = (await loadSalesSetup(tenantId, agentId)).salesRules
    return { pace: rules.replyPace ?? DEFAULT_REPLY_PACE, typing: rules.typingIndicator !== false }
  } catch {
    return { pace: DEFAULT_REPLY_PACE, typing: true }
  }
}

function redactAgentTrace(value: unknown, facts: BrandFacts): unknown {
  try {
    const masked = maskConfiguredPaymentSecrets(JSON.stringify(value ?? null), facts)
    return redactToolTrace(JSON.parse(masked))
  } catch {
    return redactToolTrace(value)
  }
}

async function servingAgentIdForTest(
  tenantId: string,
  socialAccountId: string,
  resolved: AgentResolveResult,
): Promise<string | null> {
  if (resolved.agent) return resolved.agent.id
  if (
    resolved.kind === 'skip' &&
    (resolved.skipReason === 'no_binding' || resolved.skipReason === 'binding_inactive')
  ) {
    return null
  }
  const exact = await prisma.chatAgentBinding.findFirst({
    where: {
      tenantId,
      scope: 'social_account',
      socialAccountId,
      isActive: true,
    },
    select: { agentId: true },
  })
  if (exact?.agentId) return exact.agentId
  const tenantDefault = await prisma.chatAgentBinding.findFirst({
    where: { tenantId, scope: 'tenant_default', isActive: true },
    select: { agentId: true },
  })
  return tenantDefault?.agentId ?? null
}

/** Probar — isolated multi-turn sandbox. conversationId stays null. No Meta send. */
async function runAgentTestTurnInner(input: {
  tenantId: string
  agentId: string
  inboundText: string
  socialAccountId: string
  actorUserId: string
  testSessionId: string
  messageType?: 'text' | 'image' | 'audio' | 'document' | 'video'
  history?: Array<{ direction: 'inbound' | 'outbound'; content: string; sentAt: string; messageType?: string | null }>
  windowOpen?: boolean
  customerName?: string
  conversationAiMode?: SoftAiAgentMode
  /** Probar compare mode: use this model for this test turn only (validated; provider key required). */
  modelOverride?: string
  /**
   * Unlock canaries qualify the model even when ops flags are off.
   * `flag_off` stays in `blockedBy` but does not force outcome `skip`.
   */
  ignoreLayerFlag?: boolean
  /** Images this test chat already showed (asset ids). */
  sentImageIds?: string[]
  /** Meter label: automatic checks pass 'agent_test' so they don't count as manual Probar. */
  usageFeature?: 'probar' | 'agent_test'
  /** agents2-hours: "Simular fuera de horario" (Probar only). */
  simulateAfterHours?: boolean
  /**
   * Burst hardening: when a real message was sent (shadow replay only — never from the Probar API). The burst's 24 h
   * bound is measured from it, as live measures it from the trigger; default now.
   */
  replaySentAt?: Date
}): Promise<{
  text: string
  /** agents2-format: the messages a real chat would get (one bubble each in Probar); joined = text. */
  parts: string[]
  toolTrace: unknown
  decisionTrace: unknown
  tokens: { input: number; output: number; cached: number }
  turnId: string
  latencyMs: number
  wouldSend: boolean
  outcome: 'send' | 'suggest' | 'skip'
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
  blockedBy: string[]
  notSimulatedGates: string[]
  highlightedAmounts: number[]
  intent: string
  shortcutKey: string | null
  model: string
  estimatedCostUsd: number
  /** Short reasons shown under the reply in the test chat (what it used / why it handed off). */
  why?: string[]
  /**
   * agents2-pace (quick check): raw outcome codes of this turn — validator reasons, the provider error code,
   * `escalate:<reason>`, `review`. Internal; the test engine maps them to plain Spanish.
   */
  codes?: string[]
  /** Images sent before the text (saved reply the agent used). */
  images: ReplyImage[]
  /** B1: what live would do after this text — hand the chat to a person, or ask a person to review (stays on IA). */
  handoff: TurnHandoff | null
  /** "Corregir" (V11): code answered before the model (keyword saved reply / system message). */
  decidedByCode: boolean
}> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true, platform: true },
  })
  if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND')

  const conversationAiMode = input.conversationAiMode ?? 'ai_active'
  const resolved = await resolveChatAgent({
    tenantId: input.tenantId,
    socialAccountId: input.socialAccountId,
    conversationAiMode,
  })
  const servingId = await servingAgentIdForTest(input.tenantId, input.socialAccountId, resolved)
  const boundToChannel = channelBindingBlocker(input.agentId, servingId) == null
  const baseRuntimeAgent =
    resolved.agent && resolved.agent.id === input.agentId
      ? resolved.agent
      : toResolvedChatAgent(agent)
  if (input.modelOverride && !isAllowedChatAgentModel(input.modelOverride)) {
    throw new Error('MODEL_NOT_ALLOWED')
  }
  if (input.modelOverride && !isSoftAiProviderConfigured(input.modelOverride)) {
    throw new Error('MODEL_PROVIDER_NOT_CONFIGURED')
  }
  // The override only exists for this test turn: the stored agent is never touched.
  const runtimeAgent = input.modelOverride
    ? { ...baseRuntimeAgent, model: input.modelOverride }
    : baseRuntimeAgent

  const shortcuts = await listRuntimeShortcuts(input.tenantId, runtimeAgent.id)
  const replyAssets = await loadReplyAssets(input.tenantId, runtimeAgent.id)
  const history = windowedAgentHistory(
    (input.history || []).map((message, index) => ({
      id: `test-${index}`,
      direction: message.direction,
      content: message.content,
      sentAt: message.sentAt,
      // Burst = one reply: a photo / audio earlier in the burst is planned like live (silent trial, burst scripts).
      ...(message.messageType ? { messageType: message.messageType } : {}),
    })),
  )
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId: input.tenantId, scope: input.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { enabled: true, config: true },
  })
  const soft = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId: input.tenantId, scope: input.tenantId, key: 'soft_tenant_ai_v1' },
    select: { enabled: true },
  })
  const config = parseChatAgentLayerConfig(flag?.config)
  const testTokens = await loadDailyTestTokens(input.tenantId)
  const unlockedForSend = hasAiFullUnlock(config, input.socialAccountId, {
    agentId: runtimeAgent.id,
    model: runtimeAgent.model,
    agentVersion: runtimeAgent.version,
  })
  const blockedBy = collectDryRunBlockers({
    layerEnabled: Boolean(flag?.enabled),
    softEnabled: Boolean(soft?.enabled),
    allowlisted: isAccountAllowlisted(config, input.socialAccountId),
    boundToChannel,
    operationMode: runtimeAgent.operationMode,
    unlockedForSend,
    windowOpen: input.windowOpen !== false,
    agentStatus: runtimeAgent.status,
    conversationAiMode,
  })
  if (testTokens >= config.testDailyTokenCap) {
    blockedBy.push('test_budget_blocked')
    // Budget spent: answer immediately, spend nothing and write nothing (no model call, no turn row).
    return {
      text: '',
      parts: [],
      toolTrace: [],
      decisionTrace: { blockedBy },
      tokens: { input: 0, output: 0, cached: 0 },
      turnId: '',
      latencyMs: 0,
      wouldSend: false,
      outcome: 'skip' as const,
      needsHuman: false,
      fallbackUsed: false,
      escalate: false,
      blockedBy,
      notSimulatedGates: [...PROBAR_NOT_SIMULATED_GATES],
      highlightedAmounts: [],
      intent: 'other',
      shortcutKey: null,
      model: runtimeAgent.model,
      estimatedCostUsd: 0,
      why: ['se acabó el límite diario de pruebas de este negocio: probá mañana'],
      images: [],
      handoff: null,
      decidedByCode: false,
    }
  }

  const notSimulatedGates = [...PROBAR_NOT_SIMULATED_GATES]
  // agents2-hours: Probar answers in hours unless the owner simulates the night (the quick check never does).
  const probarHours = input.simulateAfterHours === true
    ? await loadHoursSetup(input.tenantId, runtimeAgent.id).then((h) => afterHoursState(h.hours, new Date(), { simulate: true, aiDisclosure: h.aiDisclosure }))
    : IN_HOURS
  const probarInventoryIds = await loadMappedInventoryIds(input.tenantId, runtimeAgent.id)
  // Burst = one reply: the same burst planning as live (history messages keep their type when the caller sends it —
  // silent trial, burst scripts; the Probar UI sends text only). The trigger is sent "now".
  const probarTrigger = { content: input.inboundText, messageType: input.messageType || 'text', sentAt: input.replaySentAt ?? new Date() }
  const probarBurstEarlier = unansweredBurst(history, probarTrigger)
  // Like live: a photo / file / audio here or earlier in the burst needs the sale's state before the decision.
  const probarMediaSalesContext =
    isMediaLikeMessageType(input.messageType) || probarBurstEarlier.some((m) => isMediaLikeMessageType(m.messageType))
    ? await loadAgentSalesContext({
        tenantId: input.tenantId,
        agentId: runtimeAgent.id,
        inventoryItemIds: probarInventoryIds,
        brandFacts: runtimeAgent.brandFacts,
      })
    : null
  const probarImageReplyIds = imageChannel(account.platform) ? sendableImageReplyIds(replyAssets, input.sentImageIds) : new Set<string>()
  const probarBurst = planBurstInbound({
    trigger: probarTrigger,
    earlier: probarBurstEarlier,
    awaitingReceipt: (type) => mediaAwaitingReceipt(type, history, probarMediaSalesContext),
  })
  const { decision, burstReview: probarBurstReview } = decideBurstTurn({
    burst: probarBurst,
    burstEarlier: probarBurstEarlier,
    trigger: probarTrigger,
    history,
    mediaSalesContext: probarMediaSalesContext,
    earlierCustomerTexts: earlierCustomerTexts(history),
    decisionBase: {
      brandFacts: runtimeAgent.brandFacts,
      replyStyle: runtimeAgent.replyStyle,
      shortcuts,
      skipVerbatimIds: new Set([...replyAssets.keys()].filter((id) => !probarImageReplyIds.has(id))),
      awaitingPaymentMethod: awaitingPaymentMethodChoice(history),
    },
  })
  decision.decisionTrace.historyCount = history.length
  decision.decisionTrace.blockedBy = blockedBy

  let text = ''
  let intent = decision.intent
  let llmTrace: unknown = []
  let salesTrace: unknown = null
  let escalateReason: string | null = null
  let validationReasons: string[] = []
  let policyReasons: string[] = []
  let llmErrorCode: string | null = null
  let shortcutKey = decision.shortcutKey
  let highlightedAmounts = decision.highlightedAmounts
  let tokens = { input: 0, output: 0, cached: 0 }
  let latencyMs = 0
  let needsHuman = false
  let fallbackUsed = false
  let escalate = false
  let handoff: TurnHandoff | null = null
  const notBound = blockedBy.includes('not_bound_to_channel')
  const needsModel =
    !notBound && !decision.handled && !blockedBy.includes('test_budget_blocked')

  if (notBound) {
    text = ''
    intent = 'other'
    shortcutKey = null
    highlightedAmounts = []
  } else if (needsModel) {
    const knowledge = await loadApprovedKnowledgeForAgent({
      tenantId: input.tenantId,
      agentId: runtimeAgent.id,
      socialAccountId: input.socialAccountId,
    })
    const canal = await loadCanalContextForAccount({
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      fallbackPlatform: account.platform || 'whatsapp',
    })
    const runtimeInput = assembleAgentRuntimeInputs({
      agent: runtimeAgent,
      account: canal,
      history,
      inboundText: probarBurst.inboundText,
      clientName: input.customerName ?? null,
      shortcuts,
      replyImageShortcutIds: probarImageReplyIds,
      afterHoursLine: afterHoursPromptLine(probarHours),
      knowledge,
      decision,
      salesContext: await loadAgentSalesContext({
        tenantId: input.tenantId,
        agentId: runtimeAgent.id,
        inventoryItemIds: probarInventoryIds,
        brandFacts: runtimeAgent.brandFacts,
      }),
      toolCtxBase: {
        tenantId: input.tenantId,
        conversationId: 'sandbox',
        socialAccountId: input.socialAccountId,
        peerId: 'sandbox-peer',
        clientId: null,
        sandbox: true,
        inventoryItemIds: probarInventoryIds,
        // Same as the live turn (parity): order tools see this business's order stamps and the line's platform.
        orderOwnership: (await loadAgentSettings(input.tenantId, runtimeAgent.id)).orderOwnership,
        platform: account.platform || 'whatsapp',
      },
    })
    runtimeInput.usageFeature = input.usageFeature ?? 'probar'
    const llm = await runSoftAiLlmRuntime(runtimeInput)
    llmTrace = llm.toolTrace
    escalateReason = llm.escalateReason ?? null
    validationReasons = llm.validationReasons ?? []
    llmErrorCode = llm.errorCode ?? null
    salesTrace = runtimeInput.salesTrace ?? null
    const policy = applyFinalOutputPolicy({
      text: llm.text,
      intent: llm.intent || decision.intent,
      citedToolNames: llm.citedToolNames,
      inventoryPrices: llm.inventoryPrices,
      quoteAmounts: runtimeInput.salesAllowedAmounts,
      skipPurchaseSummary: Boolean(runtimeInput.salesTurnBlock),
      customerText: burstCustomerText(input.history ?? [], probarBurst.inboundText),
      allowedDeals: runtimeInput.salesAllowedDeals,
      freeShipping: runtimeInput.salesFreeShipping,
      freeShippingRule: runtimeInput.salesFreeShippingRule,
      brandFacts: runtimeAgent.brandFacts,
      replyStyle: runtimeAgent.replyStyle,
      shortcuts,
      shortenLongReply: true,
      linkAllowlist: runtimeInput.linkAllowlist,
      paymentOptions: { ...runtimeInput.salesPaymentOptions, customerText: customerTextSinceLastAnswer(input.history ?? [], probarBurst.inboundText) },
    })
    // Same plan as the live turn (B1): checked model reply, safe line, or hand-off text.
    const plan = planModelTurnDelivery({
      text: policy.text,
      textOk: llm.textOk && !policy.needsHuman,
      llmHandoff: llm.handoff,
      llmEscalateReason: llm.handoff?.kind === 'handoff' ? llm.escalateReason : null,
      receiptCue: runtimeInput.salesReceiptCue === true,
      paymentDataByTeam: runtimeInput.salesPaymentDataByTeam === true,
      codOrderReady: policy.paymentMethods.some((m) => m === 'contra_entrega' || m === 'efectivo'),
      orderReadyCash: policy.paymentMethods.includes('efectivo'),
    })
    text = withNightIntro(applyAfterHoursText(plan, probarHours, AFTER_HOURS_TEXT_OPTS), probarHours, nightIntroWho(runtimeAgent, input.history ?? []))
    handoff = plan.handoff
    intent = policy.intent
    shortcutKey = plan.text !== policy.text ? null : policy.purchaseSummaryAppended ? 'sys_purchase_summary' : llm.shortcutKey || null
    highlightedAmounts = policy.highlightedAmounts
    tokens = { input: llm.inputTokens, output: llm.outputTokens, cached: llm.cachedInputTokens }
    latencyMs = llm.latencyMs
    needsHuman = policy.needsHuman || llm.needsHuman || runtimeInput.salesNeedsHuman === true
    fallbackUsed = llm.fallbackUsed
    escalate = llm.escalate
    policyReasons = [
      ...(policy.needsHuman ? policy.reasons : []),
      ...(runtimeInput.salesNeedsHuman === true ? ['sales_needs_human'] : []),
    ]
  } else {
    const plan = planDecisionDelivery({ text: decision.text, textOk: decision.textOk, handoff: decision.handoff })
    text = withNightIntro(applyAfterHoursText(plan, probarHours, AFTER_HOURS_TEXT_OPTS), probarHours, nightIntroWho(runtimeAgent, input.history ?? []))
    handoff = plan.handoff
    needsHuman = decision.needsHuman
    escalate = decision.escalate
    fallbackUsed = false
  }

  const markers: OutcomeMarkers = notBound ? { needsHuman, fallbackUsed, escalate } : plannedMarkers({ needsHuman, fallbackUsed, escalate }, handoff)
  const outcomeBlockers = input.ignoreLayerFlag
    ? blockedBy.filter((reason) => reason !== 'flag_off')
    : blockedBy
  const outcome = decideTurnOutcome({
    effectiveBehavior: behaviorForOperationMode(runtimeAgent.operationMode),
    unlockedForSend,
    needsHuman,
    fallbackUsed,
    escalate,
    conversationAiMode,
    gateBlockers: outcomeBlockers,
    plannedReply: !notBound,
  })
  const wouldSend = outcome.outcome === 'send'
  decision.decisionTrace.wouldSend = wouldSend
  // Images of the saved reply it used (code-picked, never twice in the same chat; none on a hand-off).
  const images =
    // Same as live: WhatsApp / Instagram, never on a hand-off / needs-a-person / fallback answer.
    text && !escalate && !notBound && !needsHuman && !fallbackUsed && imageChannel(account.platform)
      ? selectReplyImages({ shortcutKey, shortcuts, assetsByShortcut: replyAssets, alreadySent: input.sentImageIds }).images
      : []
  const toolTrace = redactAgentTrace(
    withOutcomeMarkers(
      {
        ...decision.decisionTrace,
        outcome: outcome.outcome,
        outcomeReason: outcome.reason,
        wouldSend,
        blockedBy,
        notSimulatedGates,
        highlightedAmounts,
        historyCount: history.length,
        salesState: salesTrace,
        attachments: images.map((img) => img.assetId),
      },
      markers,
    ),
    runtimeAgent.brandFacts,
  )

  const testCostMicros = estimateCostMicros({
    model: runtimeAgent.model,
    inputTokens: tokens.input,
    cachedInputTokens: tokens.cached,
    outputTokens: tokens.output,
  })
  const turn = await prisma.chatAgentTurn.create({
    data: {
      tenantId: input.tenantId,
      conversationId: null,
      socialAccountId: input.socialAccountId,
      agentId: agent.id,
      triggerMessageId: null,
      automationDeliveryKey: `test:${agent.id}:${input.testSessionId}:${randomUUID()}`,
      mode: 'test',
      model: runtimeAgent.model,
      agentVersion: runtimeAgent.version,
      status: 'test',
      outputText: text,
      outputHash: hashSoftAiOutput(text || input.inboundText),
      toolTrace: toolTrace as Prisma.InputJsonValue,
      decisionTrace: toolTrace as Prisma.InputJsonValue,
      shortcutKey,
      intent,
      testSessionId: input.testSessionId,
      inputTokens: tokens.input,
      cachedInputTokens: tokens.cached,
      outputTokens: tokens.output,
      estimatedCostMicros: BigInt(testCostMicros),
      pricingVersion: pricingVersionFor(runtimeAgent.model),
      latencyMs,
      fallbackUsed,
      completedAt: new Date(),
    },
  })

  return {
    text,
    parts: text ? splitReplyParts(text) : [],
    toolTrace,
    decisionTrace: toolTrace,
    tokens,
    turnId: turn.id,
    latencyMs,
    wouldSend,
    outcome: outcome.outcome,
    needsHuman,
    fallbackUsed,
    escalate,
    blockedBy,
    notSimulatedGates,
    highlightedAmounts,
    intent,
    shortcutKey,
    model: runtimeAgent.model,
    estimatedCostUsd: testCostMicros / 1_000_000,
    why: probarWhy({ toolTrace: llmTrace, escalate, escalateReason, fallbackUsed, validationReasons, shortcutKey, blockedBy, handoffReason: (handoff ?? probarBurstReview)?.reason }),
    codes: probarOutcomeCodes({ validationReasons, policyReasons, errorCode: llmErrorCode, escalate, escalateReason, handoff: handoff ?? probarBurstReview }),
    images,
    // Burst = one reply: Probar shows the review live would raise after the reply (display only, not the markers).
    handoff: handoff ?? probarBurstReview,
    // "Corregir" (V11): code answered before the model (keyword saved reply / system message) — edit that reply instead.
    decidedByCode: !notBound && !needsModel && Boolean(text),
  }
}

type ProbarInput = Parameters<typeof runAgentTestTurnInner>[0]
type ProbarResult = Awaited<ReturnType<typeof runAgentTestTurnInner>>

/** Probar: at most a few model calls in flight per business (see probar-slots.ts). */
export async function runAgentTestTurn(input: ProbarInput): Promise<ProbarResult> {
  if (await isPlatformAiPaused()) throw new Error('AI_PAUSED')
  if (!acquireProbarSlot(input.tenantId)) throw new Error('PROBAR_BUSY')
  try {
    return await runAgentTestTurnInner(input)
  } finally {
    releaseProbarSlot(input.tenantId)
  }
}
