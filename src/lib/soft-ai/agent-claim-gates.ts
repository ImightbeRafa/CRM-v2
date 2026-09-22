/**
 * Soft Agent Layer pre-claim + pre-send gates (§2.5).
 */

import { createHash } from 'crypto'
import { prisma } from '@/lib/db'
import { waWindowOpenFromInbound } from '@/lib/chat-conversation-api'
import {
  hasAiFullUnlock,
  isAccountAllowlisted,
  parseChatAgentLayerConfig,
  CHAT_AGENT_LAYER_V1_FLAG,
} from '@/lib/soft-ai/agent-config'
import type {
  ChatAgentSkipReason,
  ChatAgentTurnStatus,
} from '@/lib/soft-ai/agent-types'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'

export type GateFail = {
  ok: false
  status: ChatAgentTurnStatus
  skipReason?: ChatAgentSkipReason
}

export type GatePass = { ok: true }

export function hashSoftAiOutput(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Gate 1 — staff outbound after trigger (not softAi). */
export async function hasHumanRepliedAfter(input: {
  conversationId: string
  triggerSentAt: Date
}): Promise<boolean> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId: input.conversationId,
      direction: 'outbound',
      sentAt: { gt: input.triggerSentAt },
    },
    select: { id: true, metadata: true },
    take: 20,
    orderBy: { sentAt: 'asc' },
  })
  for (const row of rows) {
    const meta =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {}
    if (meta.softAi === true) continue
    return true
  }
  return false
}

export async function runClaimGates(input: {
  conversationId: string
  triggerMessageId: string
  triggerSentAt: Date
  superseded: boolean
}): Promise<GatePass | GateFail> {
  if (input.superseded) {
    return { ok: false, status: 'skipped', skipReason: 'superseded' }
  }
  if (await hasHumanRepliedAfter({
    conversationId: input.conversationId,
    triggerSentAt: input.triggerSentAt,
  })) {
    return { ok: false, status: 'skipped', skipReason: 'human_replied' }
  }
  return { ok: true }
}

export async function loadDailyBilledTokens(tenantId: string): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const rows = await prisma.chatAgentTurn.aggregate({
    where: {
      tenantId,
      createdAt: { gte: start },
      status: { notIn: ['skipped'] },
      mode: { not: 'test' },
    },
    _sum: {
      inputTokens: true,
      outputTokens: true,
    },
  })
  return (rows._sum.inputTokens || 0) + (rows._sum.outputTokens || 0)
}

export async function loadDailyTestTokens(tenantId: string): Promise<number> {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const rows = await prisma.chatAgentTurn.aggregate({
    where: {
      tenantId,
      createdAt: { gte: start },
      mode: 'test',
      status: { notIn: ['skipped'] },
    },
    _sum: { inputTokens: true, outputTokens: true },
  })
  return (rows._sum.inputTokens || 0) + (rows._sum.outputTokens || 0)
}

/** Dry-run gate snapshot for Probar. Accumulates blockers; does not write. */
export function collectDryRunBlockers(input: {
  layerEnabled: boolean
  softEnabled: boolean
  allowlisted: boolean
  boundToChannel: boolean
  operationMode: string
  unlockedForSend: boolean
  windowOpen: boolean
  agentStatus: string
  conversationAiMode?: string | null
}): string[] {
  const blocked: string[] = []
  const push = (reason: string) => {
    if (!blocked.includes(reason)) blocked.push(reason)
  }
  if (!input.layerEnabled || !input.softEnabled) push('flag_off')
  if (!input.allowlisted) push('account_not_allowlisted')
  if (!input.boundToChannel) push('not_bound_to_channel')
  if (input.agentStatus !== 'live') push('agent_not_live')
  if (input.operationMode === 'human_only') push('human_only')
  if (input.conversationAiMode === 'paused') push('paused_before_send')
  else if (input.conversationAiMode === 'human') push('human_before_send')
  if (input.operationMode === 'ai_full' && !input.unlockedForSend) {
    push('ai_full_not_unlocked')
  }
  if (!input.windowOpen) push('window_closed')
  return blocked
}

export async function runPreModelGates(input: {
  tenantId: string
  socialAccountId: string
}): Promise<GatePass | GateFail> {
  const [softFlag, layerFlag] = await Promise.all([
    prisma.tenantFeatureFlag.findFirst({
      where: {
        tenantId: input.tenantId,
        scope: input.tenantId,
        key: SOFT_TENANT_AI_V1_FLAG,
      },
      select: { enabled: true },
    }),
    prisma.tenantFeatureFlag.findFirst({
      where: {
        tenantId: input.tenantId,
        scope: input.tenantId,
        key: CHAT_AGENT_LAYER_V1_FLAG,
      },
      select: { enabled: true, config: true },
    }),
  ])

  if (!softFlag?.enabled || !layerFlag?.enabled) {
    return { ok: false, status: 'skipped', skipReason: 'flag_off' }
  }
  const config = parseChatAgentLayerConfig(layerFlag.config)
  if (!isAccountAllowlisted(config, input.socialAccountId)) {
    return { ok: false, status: 'skipped', skipReason: 'account_not_allowlisted' }
  }
  const used = await loadDailyBilledTokens(input.tenantId)
  if (used >= config.dailyTokenCap) {
    return { ok: false, status: 'budget_blocked' }
  }
  return { ok: true }
}

export async function runPreSendGates(input: {
  tenantId: string
  socialAccountId: string
  conversationId: string
  triggerSentAt: Date
  agentId: string
  expectedVersion: number
  platform: string
  lastInboundAt: Date | null
  conversationAiMode: string | null | undefined
  operationMode: string
  unlockedRequired: boolean
  outputValidationOk: boolean
}): Promise<GatePass | GateFail> {
  // Gate 1 again
  if (await hasHumanRepliedAfter({
    conversationId: input.conversationId,
    triggerSentAt: input.triggerSentAt,
  })) {
    return { ok: false, status: 'skipped', skipReason: 'human_replied' }
  }

  // Gate 4 — binding + live + version
  const binding = await prisma.chatAgentBinding.findFirst({
    where: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      isActive: true,
      OR: [
        { scope: 'social_account', socialAccountId: input.socialAccountId },
        { scope: 'tenant_default', socialAccountId: null },
      ],
    },
    include: { agent: true },
  })
  if (!binding || !binding.isActive) {
    return { ok: false, status: 'skipped', skipReason: 'binding_inactive' }
  }
  if (!binding.agent || binding.agent.status !== 'live') {
    return { ok: false, status: 'skipped', skipReason: 'agent_not_live' }
  }
  if (binding.agent.version !== input.expectedVersion) {
    return { ok: false, status: 'skipped', skipReason: 'stale_version' }
  }

  // Gate 5 — sticky conversation mode
  if (input.conversationAiMode == null) {
    return { ok: false, status: 'skipped', skipReason: 'missing_mode' }
  }
  if (input.conversationAiMode === 'paused') {
    return { ok: false, status: 'skipped', skipReason: 'paused_before_send' }
  }
  if (input.conversationAiMode === 'human') {
    return { ok: false, status: 'skipped', skipReason: 'human_before_send' }
  }
  if (input.conversationAiMode !== 'ai_active') {
    return { ok: false, status: 'skipped', skipReason: 'missing_mode' }
  }

  // Gate 6 — token health
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: {
      isActive: true,
      disconnectedAt: true,
      tokenStatus: true,
      tokenLastCheckedAt: true,
    },
  })
  const tokenStatus = (account?.tokenStatus || 'unknown').toLowerCase()
  const healthy =
    account &&
    account.isActive &&
    !account.disconnectedAt &&
    (tokenStatus === 'valid' || tokenStatus === 'expiring')
  if (!healthy) {
    return { ok: false, status: 'skipped', skipReason: 'token_unhealthy' }
  }

  // Gate 7 — WA 24h window
  if (!waWindowOpenFromInbound(input.platform, input.lastInboundAt)) {
    return { ok: false, status: 'window_closed' }
  }

  // Gate 8 — daily cap
  const layerFlag = await prisma.tenantFeatureFlag.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: input.tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
    },
    select: { config: true },
  })
  const config = parseChatAgentLayerConfig(layerFlag?.config)
  const used = await loadDailyBilledTokens(input.tenantId)
  if (used >= config.dailyTokenCap) {
    return { ok: false, status: 'budget_blocked' }
  }

  // Gate 9 — provenance
  if (!input.outputValidationOk) {
    return { ok: false, status: 'fallback' }
  }

  // Gate 10 — ai_full unlock
  if (input.unlockedRequired && input.operationMode === 'ai_full') {
    if (
      !hasAiFullUnlock(config, input.socialAccountId, {
        agentId: binding.agent.id,
        model: binding.agent.model,
        agentVersion: binding.agent.version,
      })
    ) {
      return { ok: false, status: 'suggested', skipReason: 'ai_full_not_unlocked' }
    }
  }

  return { ok: true }
}
