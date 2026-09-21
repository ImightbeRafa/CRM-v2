/**
 * Soft Agent Layer turn orchestration — generate, persist, gate, deliver or suggest.
 * Extends Phase 4 queue; never imports staff bot.
 */

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  deliverOnce,
  hashSoftAiDeliveryContent,
} from '@/lib/soft-ai/automation-delivery'
import type { ClaimedChatAutomationJob } from '@/lib/soft-ai/automation-queue'
import {
  hashSoftAiOutput,
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
import { HISTORY_WINDOW_MAX } from '@/lib/soft-ai/agent-types'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
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
      outputValidationOk: true,
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
    enabledTools: resolved.agent.enabledTools,
    history,
    inboundText: payload.content,
    clientName: conversation.peerName,
    linkedOrderId: null,
    pricingVersion: 'xai-2026-09',
    toolCtx: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      socialAccountId: row.socialAccountId,
      peerId: row.peerId,
      clientId: conversation.clientId,
      enabledTools: resolved.agent.enabledTools,
      inboundText: payload.content,
    },
  })

  const outputHash = hashSoftAiOutput(llm.text)
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
      outputText: llm.text,
      outputHash,
      toolTrace: llm.toolTrace as Prisma.InputJsonValue,
      inputTokens: llm.inputTokens,
      cachedInputTokens: llm.cachedInputTokens,
      outputTokens: llm.outputTokens,
      reasoningTokens: llm.reasoningTokens,
      estimatedCostMicros: BigInt(llm.estimatedCostMicros),
      pricingVersion: 'xai-2026-09',
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
      errorCode: llm.errorCode || null,
    },
    update: {
      status: 'generated',
      outputText: llm.text,
      outputHash,
      toolTrace: llm.toolTrace as Prisma.InputJsonValue,
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
    outputText: llm.text,
    outputHash,
    outputValidationOk: !llm.needsHuman || llm.status === 'fallback',
    toolTrace: llm.toolTrace,
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
      llm.needsHuman ||
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

/** Probar — full pipeline, zero Meta, mode=test. */
export async function runAgentTestTurn(input: {
  tenantId: string
  agentId: string
  inboundText: string
  socialAccountId?: string | null
  actorUserId: string
}): Promise<{
  text: string
  toolTrace: unknown
  tokens: { input: number; output: number; cached: number }
  turnId: string
  latencyMs: number
}> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')

  const socialAccountId =
    input.socialAccountId ||
    (
      await prisma.chatAgentBinding.findFirst({
        where: {
          tenantId: input.tenantId,
          agentId: agent.id,
          scope: 'social_account',
          isActive: true,
        },
        select: { socialAccountId: true },
      })
    )?.socialAccountId

  if (!socialAccountId) throw new Error('AGENT_NO_CHANNEL')

  // Synthetic conversation id for test accounting — use a dedicated placeholder convo if present,
  // else create an ephemeral turn without conversation FK by using first matching conversation,
  // or fail closed with a clear error. Prefer an existing conversation on that account.
  const conversation = await prisma.chatConversation.findFirst({
    where: { tenantId: input.tenantId, socialAccountId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, clientId: true, peerId: true, peerName: true },
  })
  if (!conversation) throw new Error('AGENT_TEST_NO_CONVERSATION')

  const deliveryKey = `test:${agent.id}:${Date.now()}:${input.actorUserId}`
  const llm = await runSoftAiLlmRuntime({
    tenantId: input.tenantId,
    agentId: agent.id,
    agentVersion: agent.version,
    socialAccountId,
    model: agent.model,
    systemInstructions: agent.systemInstructions,
    tonePreset: agent.tonePreset as 'warm_concise' | 'formal' | 'playful',
    description: agent.description,
    introductionNames: agent.introductionNames,
    canalContext: softAiCanalContextLine({
      id: socialAccountId,
      platform: 'whatsapp',
      accountId: '',
    }),
    enabledTools: agent.enabledTools,
    history: [],
    inboundText: input.inboundText,
    clientName: conversation.peerName,
    linkedOrderId: null,
    pricingVersion: 'xai-2026-09',
    toolCtx: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      socialAccountId,
      peerId: conversation.peerId,
      clientId: conversation.clientId,
      enabledTools: agent.enabledTools,
      inboundText: input.inboundText,
    },
  })

  const turn = await prisma.chatAgentTurn.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      socialAccountId,
      agentId: agent.id,
      triggerMessageId: null,
      automationDeliveryKey: deliveryKey,
      mode: 'test',
      model: agent.model,
      agentVersion: agent.version,
      status: 'test',
      outputText: llm.text,
      outputHash: hashSoftAiOutput(llm.text),
      toolTrace: llm.toolTrace as Prisma.InputJsonValue,
      inputTokens: llm.inputTokens,
      cachedInputTokens: llm.cachedInputTokens,
      outputTokens: llm.outputTokens,
      reasoningTokens: llm.reasoningTokens,
      estimatedCostMicros: BigInt(llm.estimatedCostMicros),
      pricingVersion: 'xai-2026-09',
      latencyMs: llm.latencyMs,
      fallbackUsed: llm.fallbackUsed,
      errorCode: llm.errorCode || null,
      completedAt: new Date(),
    },
  })

  return {
    text: llm.text,
    toolTrace: llm.toolTrace,
    tokens: {
      input: llm.inputTokens,
      output: llm.outputTokens,
      cached: llm.cachedInputTokens,
    },
    turnId: turn.id,
    latencyMs: llm.latencyMs,
  }
}
