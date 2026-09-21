/**
 * Soft Agent Layer model policy — Grok 4.6 only.
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
