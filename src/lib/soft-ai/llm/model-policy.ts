/**
 * Soft Agent Layer model policy. Allowlist and default live in agent-types.
 */

import { createHash } from 'node:crypto'
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

/** OpenAI rejects a longer prompt_cache_key with 400 string_above_max_length (every Luna turn failed, 2026-10-17). */
export const SOFT_AI_PROMPT_CACHE_KEY_MAX = 64

/**
 * Prompt cache identity. Includes model so a model change cold-starts the cache. The raw identity (~95 chars of
 * cuids) is hashed to a fixed 43-char key: same inputs → same key, and it always fits the provider limit.
 */
export function buildSoftAiPromptCacheKey(input: {
  tenantId: string
  agentId: string
  agentVersion: number
  socialAccountId: string
  model: string
}): string {
  const identity = [
    input.tenantId,
    input.agentId,
    String(input.agentVersion),
    input.socialAccountId,
    input.model,
  ].join(':')
  return `sa1-${createHash('sha256').update(identity).digest('base64url').slice(0, 39)}`
}
