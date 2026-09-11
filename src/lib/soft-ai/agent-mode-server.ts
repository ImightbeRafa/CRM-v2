/**
 * F37-02 — Server-truth Soft AI agent mode for inbound Meta replies.
 * Never silently treat a missing agentState key as ai_active.
 * Soft DEMO stays client-local; production inbound uses persisted flag.config.agentState.
 */

import type { SoftAiAgentMode } from '@/lib/soft-ai/types'

export type SoftAiAgentStateRow = {
  mode?: string
  action?: string
  updatedAt?: string
  staffControlled?: boolean
}

/**
 * Resolve persisted per-thread mode from Soft AI flag config.
 * Returns null when agentState or key is missing / invalid — caller must fail closed
 * (do not Meta-auto-reply). Explicit `ai_active` required to send.
 */
export function resolvePersistedAgentMode(
  config: Record<string, unknown> | null | undefined,
  conversationKey: string,
): SoftAiAgentMode | null {
  if (!config || typeof config !== 'object') return null
  const agentState = config.agentState
  if (!agentState || typeof agentState !== 'object' || Array.isArray(agentState)) {
    return null
  }
  const row = (agentState as Record<string, SoftAiAgentStateRow | undefined>)[conversationKey]
  if (!row || typeof row !== 'object') return null
  const mode = row.mode
  if (mode === 'paused' || mode === 'human' || mode === 'ai_active') return mode
  // Legacy alias if ever stored
  if (mode === 'human_takeover') return 'human'
  return null
}

/** Meta auto-reply only when mode is explicitly ai_active. */
export function maySoftAiMetaReply(mode: SoftAiAgentMode | null): boolean {
  return mode === 'ai_active'
}

export function softAiConversationKey(socialAccountId: string, recipientId: string): string {
  return `${socialAccountId}::${recipientId}`
}
