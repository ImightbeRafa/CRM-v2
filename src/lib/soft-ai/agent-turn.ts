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
  type ResolvedChatAgent,
} from '@/lib/soft-ai/agent-resolver'
import { softAiCanalContextLine } from '@/lib/soft-ai/channel-context'
import { runSoftAiLlmRuntime } from '@/lib/soft-ai/llm/runtime'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import {
  AGENT_TOOL_NAMES,
  CHAT_AGENT_LAYER_V1_FLAG,
  HISTORY_WINDOW_MAX,
} from '@/lib/soft-ai/agent-types'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { loadApprovedKnowledgeForAgent } from '@/lib/soft-ai/knowledge-repository'
import { decideInbound } from '@/lib/soft-ai/inbound-decision'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import { applyFinalOutputPolicy, validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import {
  formatBrandFactsForPrompt,
  maskConfiguredPaymentSecrets,
  parseBrandFactsSafe,
  parseReplyStyleSafe,
  replyStyleSnippet,
  type BrandFacts,
} from '@/lib/soft-ai/brand-facts'
import { guideShortcutCatalog } from '@/lib/soft-ai/shortcuts'
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

async function loadHistory(conversationId: string): Promise<SoftAiHistoryMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId },
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
    const behavior =
      resolved.effectiveBehavior === 'send' ? ('send' as const) : ('suggest' as const)
    return finishDeliveryOrSuggest({
      row,
      payload,
      conversation,
      agent: resolved.agent,
      bindingId: resolved.binding.id,
      trigger,
      agentMode,
      effectiveBehavior: behavior,
      unlockedForSend: resolved.unlockedForSend,
      turnId: existing.id,
      outputText: existing.outputText,
      outputHash: existing.outputHash,
      outputValidationOk: validateAgentOutput({
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
        fallbackUsed: existing.fallbackUsed,
      },
    })
  }

  const account = await prisma.socialAccount.findFirst({
    where: { id: row.socialAccountId, tenantId: row.tenantId },
    select: {
      id: true,
      platform: true,
      displayName: true,
      accountId: true,
      pageId: true,
      accessToken: true,
      refreshToken: true,
    },
  })
  const canalContext = account
    ? softAiCanalContextLine({
        id: account.id,
        platform: account.platform || payload.platform || 'whatsapp',
        accountId: account.accountId || '',
        displayName: account.displayName,
      })
    : softAiCanalContextLine({
        id: row.socialAccountId,
        platform: payload.platform || 'whatsapp',
        accountId: '',
      })

  const history = await loadHistory(row.conversationId)
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
    const trace = redactAgentTrace(decision.decisionTrace, resolved.agent.brandFacts)
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
      effectiveBehavior:
        resolved.effectiveBehavior === 'send' ? ('send' as const) : ('suggest' as const),
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
      forceSuggest: decision.escalate || decision.needsHuman,
      skipReasonIfSuggest: decision.escalate ? decision.shortcutKey || undefined : undefined,
    })
  }

  const knowledge = await loadApprovedKnowledgeForAgent({
    tenantId: row.tenantId,
    agentId: resolved.agent.id,
    socialAccountId: row.socialAccountId,
  })

  const enabledTools = [
    ...new Set([
      ...resolved.agent.enabledTools,
      ...AGENT_TOOL_NAMES.filter((t) => t === 'search_approved_knowledge'),
    ]),
  ]

  const llm = await runSoftAiLlmRuntime({
    tenantId: row.tenantId,
    agentId: resolved.agent.id,
    agentVersion: resolved.agent.version,
    socialAccountId: row.socialAccountId,
    model: resolved.agent.model,
    systemInstructions: resolved.agent.systemInstructions,
    tonePreset: resolved.agent.tonePreset,
    description: resolved.agent.description,
    introductionNames: resolved.agent.introductionNames,
    canalContext,
    knowledge,
    enabledTools,
    history,
    inboundText: payload.content || '',
    clientName: conversation.peerName,
    linkedOrderId: null,
    pricingVersion: 'xai-2026-09',
    brandFactsBlock: formatBrandFactsForPrompt(resolved.agent.brandFacts),
    shortcutCatalog: guideShortcutCatalog(shortcuts),
    replyStyleSnippet: replyStyleSnippet(resolved.agent.replyStyle),
    toolCtx: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      peerId: row.peerId,
      clientId: conversation.clientId,
      enabledTools,
      inboundText: payload.content || '',
      agentId: resolved.agent.id,
      paymentClassification: decision.paymentClass,
      shortcuts,
      brandFacts: resolved.agent.brandFacts,
    },
  })

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
  const needsHuman = policy.needsHuman || llm.needsHuman || llm.fallbackUsed
  const modelTrace = redactAgentTrace(
    {
      ...decision.decisionTrace,
      validator: policy.reasons,
      highlightedAmounts: policy.highlightedAmounts,
      purchaseSummaryAppended: policy.purchaseSummaryAppended,
    },
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
    effectiveBehavior:
      resolved.effectiveBehavior === 'send' ? ('send' as const) : ('suggest' as const),
    unlockedForSend: resolved.unlockedForSend,
    turnId: turn.id,
    outputText: finalText,
    outputHash,
    outputValidationOk: !needsHuman,
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
    forceSuggest:
      needsHuman ||
      llm.fallbackUsed ||
      resolved.effectiveBehavior === 'suggest' ||
      !resolved.unlockedForSend,
    skipReasonIfSuggest:
      resolved.effectiveBehavior === 'send' && !resolved.unlockedForSend
        ? 'ai_full_not_unlocked'
        : undefined,
  })
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
  effectiveBehavior: 'suggest' | 'send'
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
  forceSuggest?: boolean
  skipReasonIfSuggest?: string
}): Promise<AgentTurnDispatchResult> {
  const wantSend =
    input.effectiveBehavior === 'send' &&
    input.unlockedForSend &&
    !input.forceSuggest

  if (!wantSend) {
    await prisma.chatAgentTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'suggested',
        skipReason: input.skipReasonIfSuggest || null,
        mode: input.agent.operationMode === 'ai_full' ? 'ai_full' : 'ai_suggest',
        completedAt: new Date(),
      },
    })
    return { status: 'suggested', turnId: input.turnId }
  }

  // Re-read conversation mode immediately before send
  const fresh = await prisma.chatConversation.findFirst({
    where: { id: input.row.conversationId, tenantId: input.row.tenantId },
    select: { aiMode: true, lastInboundAt: true },
  })
  const modeNow = normalizeConversationAiMode(fresh?.aiMode)
  if (!maySoftAiMetaReply(modeNow)) {
    const reason =
      modeNow === 'paused'
        ? 'paused_before_send'
        : modeNow === 'human'
          ? 'human_before_send'
          : 'missing_mode'
    await prisma.chatAgentTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'skipped',
        skipReason: reason,
        completedAt: new Date(),
      },
    })
    return { status: 'skipped', reason }
  }

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
    if (preSend.status === 'suggested' || preSend.skipReason === 'ai_full_not_unlocked') {
      await prisma.chatAgentTurn.update({
        where: { id: input.turnId },
        data: {
          status: 'suggested',
          skipReason: preSend.skipReason || 'ai_full_not_unlocked',
          completedAt: new Date(),
        },
      })
      return { status: 'suggested', turnId: input.turnId }
    }
    await prisma.chatAgentTurn.update({
      where: { id: input.turnId },
      data: {
        status: preSend.status,
        skipReason: preSend.skipReason || null,
        completedAt: new Date(),
      },
    })
    return { status: 'skipped', reason: preSend.skipReason || preSend.status }
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
  if (!account?.accessToken) {
    await prisma.chatAgentTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'skipped',
        skipReason: 'token_unhealthy',
        completedAt: new Date(),
      },
    })
    return { status: 'skipped', reason: 'token_unhealthy' }
  }

  const accessToken = decryptSocialAccessToken(account.accessToken)
  if (!accessToken) {
    await prisma.chatAgentTurn.update({
      where: { id: input.turnId },
      data: {
        status: 'skipped',
        skipReason: 'token_unhealthy',
        completedAt: new Date(),
      },
    })
    return { status: 'skipped', reason: 'token_unhealthy' }
  }
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
}): Promise<{
  text: string
  toolTrace: unknown
  decisionTrace: unknown
  tokens: { input: number; output: number; cached: number }
  turnId: string
  latencyMs: number
  wouldSend: boolean
  blockedBy: string[]
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

  const facts = parseBrandFactsSafe(agent.brandFacts)
  const style = parseReplyStyleSafe(agent.replyStyle)
  const shortcuts = await listRuntimeShortcuts(input.tenantId, agent.id)
  const history = (input.history || []).slice(-40)
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
  const blockedBy = collectDryRunBlockers({
    layerEnabled: Boolean(flag?.enabled),
    softEnabled: Boolean(soft?.enabled),
    allowlisted: isAccountAllowlisted(config, input.socialAccountId),
    operationMode: agent.operationMode,
    unlockedForSend: hasAiFullUnlock(config, input.socialAccountId),
    windowOpen: input.windowOpen !== false,
    agentStatus: agent.status,
    conversationAiMode: 'ai_active',
  })
  if (testTokens >= config.testDailyTokenCap) blockedBy.push('test_budget_blocked')
  const wouldSend = blockedBy.length === 0 && agent.operationMode === 'ai_full'

  const decision = decideInbound({
    inboundText: input.inboundText,
    messageType: input.messageType || 'text',
    brandFacts: facts,
    replyStyle: style,
    shortcuts,
  })
  decision.decisionTrace.historyCount = history.length
  decision.decisionTrace.wouldSend = wouldSend
  decision.decisionTrace.blockedBy = blockedBy

  let text = decision.text
  let toolTrace: unknown = decision.decisionTrace
  let tokens = { input: 0, output: 0, cached: 0 }
  let latencyMs = 0
  let intent = decision.intent
  let shortcutKey = decision.shortcutKey
  let highlightedAmounts = decision.highlightedAmounts
  const needsModel = !decision.handled && !blockedBy.includes('test_budget_blocked')

  if (needsModel) {
    const knowledge = await loadApprovedKnowledgeForAgent({
      tenantId: input.tenantId,
      agentId: agent.id,
      socialAccountId: input.socialAccountId,
    })
    const enabledTools = [
      ...new Set([
        ...agent.enabledTools,
        ...AGENT_TOOL_NAMES.filter((name) => name === 'search_approved_knowledge' || name === 'use_shortcut'),
      ]),
    ]
    const llm = await runSoftAiLlmRuntime({
      tenantId: input.tenantId,
      agentId: agent.id,
      agentVersion: agent.version,
      socialAccountId: input.socialAccountId,
      model: agent.model,
      systemInstructions: agent.systemInstructions,
      tonePreset: agent.tonePreset as 'warm_concise' | 'formal' | 'playful',
      description: agent.description,
      introductionNames: agent.introductionNames,
      canalContext: softAiCanalContextLine({
        id: account.id,
        platform: account.platform || 'whatsapp',
        accountId: '',
      }),
      knowledge,
      enabledTools,
      history: history.map((message, index) => ({
        id: `test-${index}`,
        direction: message.direction,
        content: message.content,
        sentAt: message.sentAt,
      })),
      inboundText: input.inboundText,
      clientName: null,
      linkedOrderId: null,
      pricingVersion: 'xai-2026-09',
      brandFactsBlock: formatBrandFactsForPrompt(facts),
      shortcutCatalog: guideShortcutCatalog(shortcuts),
      replyStyleSnippet: replyStyleSnippet(style),
      toolCtx: {
        tenantId: input.tenantId,
        conversationId: 'sandbox',
        socialAccountId: input.socialAccountId,
        peerId: 'sandbox-peer',
        clientId: null,
        enabledTools,
        inboundText: input.inboundText,
        agentId: agent.id,
        paymentClassification: decision.paymentClass,
        shortcuts,
        brandFacts: facts,
        sandbox: true,
      },
    })
    const policy = applyFinalOutputPolicy({
      text: llm.text,
      intent: llm.intent || 'other',
      citedToolNames: llm.citedToolNames,
      inventoryPrices: llm.inventoryPrices,
      brandFacts: facts,
      replyStyle: style,
      shortcuts,
    })
    text = policy.text
    intent = policy.intent
    shortcutKey = policy.purchaseSummaryAppended ? 'sys_purchase_summary' : llm.shortcutKey || null
    highlightedAmounts = policy.highlightedAmounts
    tokens = { input: llm.inputTokens, output: llm.outputTokens, cached: llm.cachedInputTokens }
    latencyMs = llm.latencyMs
    toolTrace = redactAgentTrace(
      {
        ...decision.decisionTrace,
        validator: policy.reasons,
        highlightedAmounts,
        modelCalls: llm.fallbackUsed ? 0 : 1,
      },
      facts,
    )
  } else {
    toolTrace = redactAgentTrace(decision.decisionTrace, facts)
  }

  const turn = await prisma.chatAgentTurn.create({
    data: {
      tenantId: input.tenantId,
      conversationId: null,
      socialAccountId: input.socialAccountId,
      agentId: agent.id,
      triggerMessageId: null,
      automationDeliveryKey: `test:${agent.id}:${input.testSessionId}:${randomUUID()}`,
      mode: 'test',
      model: agent.model,
      agentVersion: agent.version,
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
      fallbackUsed: false,
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
    blockedBy,
    highlightedAmounts,
    intent,
    shortcutKey,
  }
}

