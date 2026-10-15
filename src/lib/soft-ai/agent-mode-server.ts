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
export function normalizeConversationAiMode(
  value: string | null | undefined,
): SoftAiAgentMode | null {
  if (value === 'paused' || value === 'human' || value === 'ai_active') return value
  if (value === 'human_takeover') return 'human'
  return null
}

/** Column `aiMode` wins; fall back to TenantFeatureFlag.config.agentState[key]. */
export function resolveSoftAiAgentMode(opts: {
  conversationAiMode: string | null | undefined
  flagConfig: Record<string, unknown> | null | undefined
  conversationKey: string
}): SoftAiAgentMode | null {
  const fromColumn = normalizeConversationAiMode(opts.conversationAiMode)
  if (fromColumn) return fromColumn
  return resolvePersistedAgentMode(opts.flagConfig, opts.conversationKey)
}

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

/**
 * STUB (stream B worktree): stream A owns the real versions of effectiveConversationAiMode / humanWroteRecently
 * (claudio/agents2-a-status). Same names and semantics; A's implementation wins at integration.
 * Column wins, then the persisted agentState; a NULL chat follows its line: line on → 'ai_active', unless a person
 * wrote in it recently → 'human'; line off → null (fail closed).
 */
export function effectiveConversationAiMode(input: {
  column: string | null | undefined
  persisted: SoftAiAgentMode | null
  lineOn: boolean
  humanWroteRecently: boolean
}): { mode: SoftAiAgentMode | null; via: 'column' | 'state' | 'line' | 'none' } {
  const fromColumn = normalizeConversationAiMode(input.column)
  if (fromColumn) return { mode: fromColumn, via: 'column' }
  if (input.persisted) return { mode: input.persisted, via: 'state' }
  if (input.lineOn) return { mode: input.humanWroteRecently ? 'human' : 'ai_active', via: 'line' }
  return { mode: null, via: 'none' }
}

/** A person (outbound without softAi metadata) wrote in this chat in the last `hours` (tenant-scoped). */
export async function humanWroteRecently(tenantId: string, conversationId: string, hours = 24): Promise<boolean> {
  const { prisma } = await import('@/lib/db')
  const since = new Date(Date.now() - hours * 3_600_000)
  const rows = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId, direction: 'outbound', sentAt: { gte: since } },
    orderBy: { sentAt: 'desc' },
    take: 50,
    select: { metadata: true },
  })
  return rows.some((row) => {
    const meta = row.metadata
    return !(meta && typeof meta === 'object' && !Array.isArray(meta) && (meta as Record<string, unknown>).softAi === true)
  })
}
