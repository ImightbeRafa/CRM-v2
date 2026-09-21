/**
 * Soft Agent Layer binding resolution + effective mode compose.
 */

import 'server-only'

import { prisma } from '@/lib/db'
import {
  hasAiFullUnlock,
  isAccountAllowlisted,
  parseChatAgentLayerConfig,
  CHAT_AGENT_LAYER_V1_FLAG,
} from '@/lib/soft-ai/agent-config'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import {
  isAllowedChatAgentModel,
  type ChatAgentOperationMode,
  type ChatAgentSkipReason,
  type ChatAgentStatus,
  type ChatAgentTonePreset,
  type EffectiveAgentBehavior,
} from '@/lib/soft-ai/agent-types'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { shouldUseSoftTenantAiV1 } from '@/lib/feature-flags'

export type ResolvedChatAgent = {
  id: string
  tenantId: string
  name: string
  emoji: string
  description: string | null
  systemInstructions: string
  tonePreset: ChatAgentTonePreset
  model: string
  operationMode: ChatAgentOperationMode
  enabledTools: string[]
  introductionNames: string[]
  status: ChatAgentStatus
  version: number
}

export type ResolvedBinding = {
  id: string
  scope: 'social_account' | 'tenant_default'
  agentId: string
  socialAccountId: string | null
  isActive: boolean
}

export type AgentResolveResult =
  | {
      kind: 'resolved'
      agent: ResolvedChatAgent
      binding: ResolvedBinding
      effectiveBehavior: EffectiveAgentBehavior
      effectiveMode: ChatAgentOperationMode
      unlockedForSend: boolean
      skipReason?: undefined
    }
  | {
      kind: 'skip'
      skipReason: ChatAgentSkipReason
      agent?: ResolvedChatAgent
      binding?: ResolvedBinding
    }

function asTone(value: string): ChatAgentTonePreset {
  if (value === 'formal' || value === 'playful' || value === 'warm_concise') return value
  return 'warm_concise'
}

function asMode(value: string): ChatAgentOperationMode {
  if (value === 'ai_full' || value === 'ai_suggest' || value === 'human_only') return value
  return 'human_only'
}

function asStatus(value: string): ChatAgentStatus {
  if (value === 'draft' || value === 'live' || value === 'archived') return value
  return 'draft'
}

export function composeEffectiveBehavior(input: {
  conversationAiMode: SoftAiAgentMode | null | undefined
  operationMode: ChatAgentOperationMode
  unlockedForSend: boolean
}): { behavior: EffectiveAgentBehavior; effectiveMode: ChatAgentOperationMode; skipReason?: ChatAgentSkipReason } {
  const convo = input.conversationAiMode
  if (convo == null) {
    return { behavior: 'skip', effectiveMode: input.operationMode, skipReason: 'missing_mode' }
  }
  if (convo === 'paused') {
    return { behavior: 'skip', effectiveMode: input.operationMode, skipReason: 'paused_before_send' }
  }
  if (convo === 'human') {
    return { behavior: 'skip', effectiveMode: input.operationMode, skipReason: 'human_before_send' }
  }
  // convo === 'ai_active'
  if (input.operationMode === 'human_only') {
    return { behavior: 'human_only', effectiveMode: 'human_only', skipReason: 'human_only' }
  }
  if (input.operationMode === 'ai_suggest') {
    return { behavior: 'suggest', effectiveMode: 'ai_suggest' }
  }
  // ai_full — conversation can only restrict; unlock required to send
  if (!input.unlockedForSend) {
    return { behavior: 'suggest', effectiveMode: 'ai_full' }
  }
  return { behavior: 'send', effectiveMode: 'ai_full' }
}

async function readAgentLayerFlag(tenantId: string) {
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: {
      tenantId,
      scope: tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
    },
    select: { enabled: true, config: true },
  })
  return {
    enabled: Boolean(flag?.enabled),
    config: parseChatAgentLayerConfig(flag?.config),
  }
}

function mapAgent(row: {
  id: string
  tenantId: string
  name: string
  emoji: string
  description: string | null
  systemInstructions: string
  tonePreset: string
  model: string
  operationMode: string
  enabledTools: string[]
  introductionNames?: string[] | null
  status: string
  version: number
}): ResolvedChatAgent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    systemInstructions: row.systemInstructions,
    tonePreset: asTone(row.tonePreset),
    model: row.model,
    operationMode: asMode(row.operationMode),
    enabledTools: row.enabledTools || [],
    introductionNames: row.introductionNames || [],
    status: asStatus(row.status),
    version: row.version,
  }
}

/**
 * Resolve agent for an inbound. When the Agent Layer flag is off, returns
 * skip/flag_off so the processor keeps the legacy Soft path.
 * When flag is on but account not allowlisted → skip (never legacy for that account).
 */
export async function resolveChatAgent(input: {
  tenantId: string
  socialAccountId: string
  conversationAiMode: SoftAiAgentMode | null | undefined
}): Promise<AgentResolveResult & { layerEnabled: boolean; softAiEnabled: boolean }> {
  const softAiEnabled = await shouldUseSoftTenantAiV1(input.tenantId)
  const layer = await readAgentLayerFlag(input.tenantId)

  if (!layer.enabled) {
    return {
      kind: 'skip',
      skipReason: 'flag_off',
      layerEnabled: false,
      softAiEnabled,
    }
  }

  if (!softAiEnabled) {
    return {
      kind: 'skip',
      skipReason: 'flag_off',
      layerEnabled: true,
      softAiEnabled: false,
    }
  }

  if (!isAccountAllowlisted(layer.config, input.socialAccountId)) {
    return {
      kind: 'skip',
      skipReason: 'account_not_allowlisted',
      layerEnabled: true,
      softAiEnabled,
    }
  }

  const schemaReady = await isChatAgentSchemaReady()
  if (!schemaReady) {
    return {
      kind: 'skip',
      skipReason: 'schema_not_ready',
      layerEnabled: true,
      softAiEnabled,
    }
  }

  try {
    const accountBinding = await prisma.chatAgentBinding.findFirst({
      where: {
        tenantId: input.tenantId,
        scope: 'social_account',
        socialAccountId: input.socialAccountId,
        isActive: true,
      },
      include: { agent: true },
    })

    let bindingRow = accountBinding
    let usedExact = Boolean(accountBinding)

    if (!bindingRow) {
      bindingRow = await prisma.chatAgentBinding.findFirst({
        where: {
          tenantId: input.tenantId,
          scope: 'tenant_default',
          isActive: true,
        },
        include: { agent: true },
      })
      usedExact = false
    }

    if (!bindingRow || !bindingRow.agent) {
      return {
        kind: 'skip',
        skipReason: 'no_binding',
        layerEnabled: true,
        softAiEnabled,
      }
    }

    if (!bindingRow.isActive) {
      return {
        kind: 'skip',
        skipReason: 'binding_inactive',
        layerEnabled: true,
        softAiEnabled,
        binding: {
          id: bindingRow.id,
          scope: bindingRow.scope as 'social_account' | 'tenant_default',
          agentId: bindingRow.agentId,
          socialAccountId: bindingRow.socialAccountId,
          isActive: false,
        },
      }
    }

    const agent = mapAgent(bindingRow.agent)

    // Exact social_account binding that points at invalid agent → fail closed (no tenant default).
    if (usedExact) {
      if (agent.status !== 'live') {
        return {
          kind: 'skip',
          skipReason: agent.status === 'draft' ? 'draft_agent' : 'agent_not_live',
          layerEnabled: true,
          softAiEnabled,
          agent,
          binding: {
            id: bindingRow.id,
            scope: 'social_account',
            agentId: agent.id,
            socialAccountId: bindingRow.socialAccountId,
            isActive: true,
          },
        }
      }
      if (!isAllowedChatAgentModel(agent.model) || agent.tenantId !== input.tenantId) {
        return {
          kind: 'skip',
          skipReason: 'model_not_allowed',
          layerEnabled: true,
          softAiEnabled,
          agent,
          binding: {
            id: bindingRow.id,
            scope: 'social_account',
            agentId: agent.id,
            socialAccountId: bindingRow.socialAccountId,
            isActive: true,
          },
        }
      }
    } else {
      if (agent.status !== 'live') {
        return {
          kind: 'skip',
          skipReason: agent.status === 'draft' ? 'draft_agent' : 'agent_not_live',
          layerEnabled: true,
          softAiEnabled,
          agent,
          binding: {
            id: bindingRow.id,
            scope: 'tenant_default',
            agentId: agent.id,
            socialAccountId: null,
            isActive: true,
          },
        }
      }
      if (!isAllowedChatAgentModel(agent.model)) {
        return {
          kind: 'skip',
          skipReason: 'model_not_allowed',
          layerEnabled: true,
          softAiEnabled,
          agent,
        }
      }
    }

    const unlockedForSend = hasAiFullUnlock(layer.config, input.socialAccountId)
    const composed = composeEffectiveBehavior({
      conversationAiMode: input.conversationAiMode,
      operationMode: agent.operationMode,
      unlockedForSend,
    })

    if (composed.behavior === 'skip' || composed.behavior === 'human_only') {
      return {
        kind: 'skip',
        skipReason: composed.skipReason || 'human_only',
        layerEnabled: true,
        softAiEnabled,
        agent,
        binding: {
          id: bindingRow.id,
          scope: (usedExact ? 'social_account' : 'tenant_default') as
            | 'social_account'
            | 'tenant_default',
          agentId: agent.id,
          socialAccountId: bindingRow.socialAccountId,
          isActive: true,
        },
      }
    }

    return {
      kind: 'resolved',
      layerEnabled: true,
      softAiEnabled,
      agent,
      binding: {
        id: bindingRow.id,
        scope: (usedExact ? 'social_account' : 'tenant_default') as
          | 'social_account'
          | 'tenant_default',
        agentId: agent.id,
        socialAccountId: bindingRow.socialAccountId,
        isActive: true,
      },
      effectiveBehavior: composed.behavior,
      effectiveMode: composed.effectiveMode,
      unlockedForSend,
    }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        kind: 'skip',
        skipReason: 'schema_not_ready',
        layerEnabled: true,
        softAiEnabled,
      }
    }
    throw error
  }
}

export async function readChatAgentLayerFlag(tenantId: string) {
  return readAgentLayerFlag(tenantId)
}
