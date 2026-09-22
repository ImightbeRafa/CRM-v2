/**
 * Soft Agent Layer model policy. Allowlist and default live in agent-types.
 */

import {
  CHAT_AGENT_MODEL_ALLOWLIST,
  isAllowedChatAgentModel,
  type ChatAgentModel,
} from '@/lib/soft-ai/agent-types'

export const SOFT_AI_MAX_MODEL_CALLS = 2
export const SOFT_AI_MAX_TOOL_CALLS = 4

export function assertAllowedModel(model: string): ChatAgentModel {
  if (!isAllowedChatAgentModel(model)) {
    throw new Error('SOFT_AI_MODEL_NOT_ALLOWED')
  }
  return model
}

export function softAiModelAllowlist(): readonly string[] {
  return CHAT_AGENT_MODEL_ALLOWLIST
}

/** Prompt cache identity. Includes model so a model change cold-starts the cache. */
export function buildSoftAiPromptCacheKey(input: {
  tenantId: string
  agentId: string
  agentVersion: number
  socialAccountId: string
  model: string
}): string {
  return [
    input.tenantId,
    input.agentId,
    String(input.agentVersion),
    input.socialAccountId,
    input.model,
  ].join(':')
}
