/**
 * Soft Agent Layer turn orchestration — generate, persist, gate, deliver or suggest.
 * Extends Phase 4 queue; never imports staff bot.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  deliverOnce,
  hashSoftAiDeliveryContent,
} from '@/lib/soft-ai/automation-delivery'
import type { ClaimedChatAutomationJob } from '@/lib/soft-ai/automation-queue'
import {
  collectDryRunBlockers,
  hashSoftAiOutput,
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
import { runSoftAiLlmRuntime } from '@/lib/soft-ai/llm/runtime'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  HISTORY_WINDOW_MAX,
  type EffectiveAgentBehavior,
} from '@/lib/soft-ai/agent-types'
import {
  assembleAgentRuntimeInputs,
  channelBindingBlocker,
  chatHistoryWhere,
  loadCanalContextForAccount,
  toResolvedChatAgent,
  windowedAgentHistory,
} from '@/lib/soft-ai/agent-turn-inputs'
import {
  behaviorForOperationMode,
  decideTurnOutcome,
  PROBAR_NOT_SIMULATED_GATES,
  readOutcomeMarkers,
  withOutcomeMarkers,
  type AgentTurnOutcome,
  type OutcomeMarkers,
} from '@/lib/soft-ai/agent-turn-outcome'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { loadApprovedKnowledgeForAgent } from '@/lib/soft-ai/knowledge-repository'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import { applyFinalOutputPolicy, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
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
  maySoftAiMetaReply,
  normalizeConversationAiMode,
  resolveSoftAiAgentMode,
  softAiConversationKey,
} from '@/lib/soft-ai/agent-mode-server'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { readSoftTenantAiConfig } from '@/lib/feature-flags'

type JobPayload = {
  platform?: string | null
  content?: string | null
  senderName?: string | null
}

function readPayload(payload: unknown): JobPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const p = payload as Record<string, unknown>
  return {
    platform: typeof p.platform === 'string' ? p.platform : null,
    content: typeof p.content === 'string' ? p.content : null,
    senderName: typeof p.senderName === 'string' ? p.senderName : null,
  }
}

async function loadHistory(
  conversationId: string,
  triggerMessageId: string,
): Promise<SoftAiHistoryMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: chatHistoryWhere(conversationId, triggerMessageId),
    orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    take: HISTORY_WINDOW_MAX,
    select: {
      id: true,
      direction: true,
      content: true,
      sentAt: true,
    },
  })
  return rows
    .reverse()
    .filter((r) => r.direction === 'inbound' || r.direction === 'outbound')
    .map((r) => ({
      id: r.id,
      direction: r.direction as 'inbound' | 'outbound',
      content: r.content,
      sentAt: r.sentAt.toISOString(),
    }))
}

async function loadTriggerMessage(messageId: string) {
  return prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      sentAt: true,
      content: true,
      messageType: true,
      direction: true,
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
    return { ok: false, error: 'platform_not_supported_for_agent_send' }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 80) : 'meta_send_failed',
    }
  }
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

export type AgentTurnDispatchResult =
  | { status: 'skipped'; reason?: string }
  | { status: 'suggested'; turnId: string }
  | { status: 'delivered'; turnId: string; skippedDelivery?: boolean }
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
  const agentMode = resolveSoftAiAgentMode({
    conversationAiMode: conversation.aiMode,
    flagConfig,
    conversationKey: softAiConversationKey(row.socialAccountId, row.peerId),
  })

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
    return { status: 'skipped', reason: resolved.skipReason }
  }

  const trigger = await loadTriggerMessage(row.messageId)
  if (!trigger) {
    return { status: 'skipped', reason: 'trigger_missing' }
  }

  const claimGate = await runClaimGates({
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

  const preModel = await runPreModelGates({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
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
    return { status: 'skipped', reason: preModel.skipReason || preModel.status }
  }

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
    return finishDeliveryOrSuggest({
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
      outputText: existing.outputText,
      outputHash: existing.outputHash,
      outputValidationOk:
        reclaimed != null &&
        !needsHuman &&
        !fallbackUsed &&
        validateAgentOutput({
          text: existing.outputText,
          citedToolNames: [],
          shippingAmounts: [],
        }).ok,
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

  const history = await loadHistory(row.conversationId, trigger.id)
  const shortcuts = await listRuntimeShortcuts(row.tenantId, resolved.agent.id)
  const decision = decideInbound({
    inboundText: payload.content || '',
    messageType: trigger.messageType,
    brandFacts: resolved.agent.brandFacts,
    replyStyle: resolved.agent.replyStyle,
    shortcuts,
  })
  decision.decisionTrace.historyCount = history.length

  if (decision.handled) {
    const outputHash = hashSoftAiOutput(decision.text)
    const handledMarkers: OutcomeMarkers = {
      needsHuman: decision.needsHuman,
      fallbackUsed: false,
      escalate: decision.escalate,
    }
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
        outputText: decision.text,
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
        pricingVersion: 'xai-2026-09',
        latencyMs: 0,
        fallbackUsed: false,
        errorCode: decision.escalate ? decision.shortcutKey : null,
      },
      update: {
        status: 'generated',
        outputText: decision.text,
        outputHash,
        toolTrace: trace as Prisma.InputJsonValue,
        decisionTrace: trace as Prisma.InputJsonValue,
        shortcutKey: decision.shortcutKey,
        intent: decision.intent,
        errorCode: decision.escalate ? decision.shortcutKey : null,
      },
    })
    if (decision.escalate) {
      await prisma.chatConversation.updateMany({
        where: { id: row.conversationId, tenantId: row.tenantId },
        data: { aiMode: 'human' },
      })
    }
    return finishDeliveryOrSuggest({
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
      outputText: decision.text,
      outputHash,
      outputValidationOk: !decision.needsHuman,
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
    inboundText: payload.content || '',
    clientName: conversation.peerName,
    shortcuts,
    knowledge,
    decision,
    toolCtxBase: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      peerId: row.peerId,
      clientId: conversation.clientId,
    },
  })
  const llm = await runSoftAiLlmRuntime(runtimeInput)

  const policy = applyFinalOutputPolicy({
    text: llm.text,
    intent: llm.intent || decision.intent,
    citedToolNames: llm.citedToolNames,
    inventoryPrices: llm.inventoryPrices,
    brandFacts: resolved.agent.brandFacts,
    replyStyle: resolved.agent.replyStyle,
    shortcuts,
  })
  const finalText = policy.text
  const needsHuman = policy.needsHuman || llm.needsHuman
  const modelMarkers: OutcomeMarkers = {
    needsHuman,
    fallbackUsed: llm.fallbackUsed,
    escalate: llm.escalate,
  }
  const modelTrace = redactAgentTrace(
    withOutcomeMarkers(
      {
        ...decision.decisionTrace,
        validator: policy.reasons,
        highlightedAmounts: policy.highlightedAmounts,
        purchaseSummaryAppended: policy.purchaseSummaryAppended,
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
      pricingVersion: 'xai-2026-09',
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
      errorCode: llm.errorCode || (needsHuman ? policy.reasons[0] || null : null),
    },
    update: {
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

  if (llm.escalate) {
    await prisma.chatConversation.updateMany({
      where: { id: row.conversationId, tenantId: row.tenantId },
      data: { aiMode: 'human' },
    })
  }

  return finishDeliveryOrSuggest({
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
    outputValidationOk: !needsHuman && !llm.fallbackUsed,
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

async function finishDeliveryOrSuggest(input: {
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
  trigger: { id: string; sentAt: Date }
  agentMode: string | null
  effectiveBehavior: EffectiveAgentBehavior
  unlockedForSend: boolean
  turnId: string
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
}): Promise<AgentTurnDispatchResult> {
  const decisionBase = {
    effectiveBehavior: input.effectiveBehavior,
    unlockedForSend: input.unlockedForSend,
    needsHuman: input.needsHuman,
    fallbackUsed: input.fallbackUsed || input.usage.fallbackUsed,
    escalate: input.escalate,
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
  const modeNow = normalizeConversationAiMode(fresh?.aiMode)
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
  const contentHash = hashSoftAiDeliveryContent(input.outputText)

  const delivery = await deliverOnce({
    jobId: input.row.id,
    deliveryKey: input.row.deliveryKey,
    kind: 'text',
    contentHash,
    send: async () => {
      const result = await sendMetaText({
        platform: input.payload.platform || 'whatsapp',
        accessToken,
        phoneNumberId: account.accountId,
        pageId: account.pageId || meta.pageId,
        recipient: input.row.peerId,
        text: input.outputText,
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

  const providerMessageId =
    delivery.providerDeliveryId ||
    (!delivery.skipped ? delivery.result?.providerMessageId : undefined)

  await dualWriteChatMessage({
    tenantId: input.row.tenantId,
    socialAccountId: input.row.socialAccountId,
    direction: 'outbound',
    content: input.outputText,
    sentAt: new Date(),
    peerId: input.row.peerId,
    peerName: input.payload.senderName || input.conversation.peerName || null,
    providerMessageId: providerMessageId || null,
    messageType: 'text',
    deliveryStatus: 'sent',
    platform: input.payload.platform || 'whatsapp',
    metadata: {
      softAi: true,
      agentId: input.agent.id,
      agentVersion: input.agent.version,
      turnId: input.turnId,
      toolTrace: input.toolTrace,
      to: input.row.peerId,
      platform: input.payload.platform,
      providerMessageId,
      automationJobId: input.row.id,
      deliverySkipped: delivery.skipped,
    },
    suppressSoftAi: true,
  })

  await prisma.chatAgentTurn.update({
    where: { id: input.turnId },
    data: {
      status: 'delivered',
      skipReason: null,
      completedAt: new Date(),
    },
  })

  return {
    status: 'delivered',
    turnId: input.turnId,
    skippedDelivery: delivery.skipped,
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
export async function runAgentTestTurn(input: {
  tenantId: string
  agentId: string
  inboundText: string
  socialAccountId: string
  actorUserId: string
  testSessionId: string
  messageType?: 'text' | 'image' | 'audio' | 'document' | 'video'
  history?: Array<{ direction: 'inbound' | 'outbound'; content: string; sentAt: string }>
  windowOpen?: boolean
  customerName?: string
  conversationAiMode?: SoftAiAgentMode
  /**
   * Unlock canaries qualify the model even when ops flags are off.
   * `flag_off` stays in `blockedBy` but does not force outcome `skip`.
   */
  ignoreLayerFlag?: boolean
}): Promise<{
  text: string
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
  const runtimeAgent =
    resolved.agent && resolved.agent.id === input.agentId
      ? resolved.agent
      : toResolvedChatAgent(agent)

  const shortcuts = await listRuntimeShortcuts(input.tenantId, runtimeAgent.id)
  const history = windowedAgentHistory(
    (input.history || []).map((message, index) => ({
      id: `test-${index}`,
      direction: message.direction,
      content: message.content,
      sentAt: message.sentAt,
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
  if (testTokens >= config.testDailyTokenCap) blockedBy.push('test_budget_blocked')

  const notSimulatedGates = [...PROBAR_NOT_SIMULATED_GATES]
  const decision = decideInbound({
    inboundText: input.inboundText,
    messageType: input.messageType || 'text',
    brandFacts: runtimeAgent.brandFacts,
    replyStyle: runtimeAgent.replyStyle,
    shortcuts,
  })
  decision.decisionTrace.historyCount = history.length
  decision.decisionTrace.blockedBy = blockedBy

  let text = ''
  let intent = decision.intent
  let shortcutKey = decision.shortcutKey
  let highlightedAmounts = decision.highlightedAmounts
  let tokens = { input: 0, output: 0, cached: 0 }
  let latencyMs = 0
  let needsHuman = false
  let fallbackUsed = false
  let escalate = false
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
      inboundText: input.inboundText,
      clientName: input.customerName ?? null,
      shortcuts,
      knowledge,
      decision,
      toolCtxBase: {
        tenantId: input.tenantId,
        conversationId: 'sandbox',
        socialAccountId: input.socialAccountId,
        peerId: 'sandbox-peer',
        clientId: null,
        sandbox: true,
      },
    })
    const llm = await runSoftAiLlmRuntime(runtimeInput)
    const policy = applyFinalOutputPolicy({
      text: llm.text,
      intent: llm.intent || 'other',
      citedToolNames: llm.citedToolNames,
      inventoryPrices: llm.inventoryPrices,
      brandFacts: runtimeAgent.brandFacts,
      replyStyle: runtimeAgent.replyStyle,
      shortcuts,
    })
    text = policy.text
    intent = policy.intent
    shortcutKey = policy.purchaseSummaryAppended ? 'sys_purchase_summary' : llm.shortcutKey || null
    highlightedAmounts = policy.highlightedAmounts
    tokens = { input: llm.inputTokens, output: llm.outputTokens, cached: llm.cachedInputTokens }
    latencyMs = llm.latencyMs
    needsHuman = policy.needsHuman || llm.needsHuman
    fallbackUsed = llm.fallbackUsed
    escalate = llm.escalate
  } else {
    text = decision.text
    needsHuman = decision.needsHuman
    escalate = decision.escalate
    fallbackUsed = false
  }

  const markers: OutcomeMarkers = { needsHuman, fallbackUsed, escalate }
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
  })
  const wouldSend = outcome.outcome === 'send'
  decision.decisionTrace.wouldSend = wouldSend
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
      },
      markers,
    ),
    runtimeAgent.brandFacts,
  )

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
      estimatedCostMicros: BigInt(0),
      pricingVersion: 'xai-2026-09',
      latencyMs,
      fallbackUsed,
      completedAt: new Date(),
    },
  })

  return {
    text,
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
  }
}
