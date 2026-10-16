/**
 * F37-02 — Server-truth Soft AI agent mode for inbound Meta replies.
 * Never silently treat a missing agentState key as ai_active.
 * Soft DEMO stays client-local; production inbound uses persisted flag.config.agentState.
 */

import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { isSoftAiOutboundMetadata } from '@/lib/soft-ai/agent-inbox-projection'

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


export type EffectiveAiModeVia = 'column' | 'state' | 'line' | 'none'

/**
 * Agentes IA 2.0 — "chats follow the line" (PURE). The mode a conversation really has:
 *  1. the `aiMode` column wins ('human' / 'paused' / 'ai_active');
 *  2. then the legacy flag agentState (persisted);
 *  3. a chat with no mode on a line that is ON is the AI's ('ai_active', old chats included) — unless a person
 *     wrote in it in the last 24 h (Rafael's default): then it stays with the person ('human');
 *  4. otherwise null (line off: nobody answers automatically).
 * Resolved where the mode is read; rows are never mass-updated.
 */
export function effectiveConversationAiMode(input: {
  column: string | null | undefined
  persisted: SoftAiAgentMode | null
  lineOn: boolean
  humanWroteRecently: boolean
}): { mode: SoftAiAgentMode | null; via: EffectiveAiModeVia } {
  const fromColumn = normalizeConversationAiMode(input.column)
  if (fromColumn) return { mode: fromColumn, via: 'column' }
  const persisted = normalizeConversationAiMode(input.persisted)
  if (persisted) return { mode: persisted, via: 'state' }
  if (!input.lineOn) return { mode: null, via: 'none' }
  return { mode: input.humanWroteRecently ? 'human' : 'ai_active', via: 'line' }
}

/** Optional reader for humanWroteRecently (tests inject one; the server default is a tenant-scoped Prisma read). */
export type RecentOutboundReader = (args: {
  tenantId: string
  conversationId: string
  since: Date
}) => Promise<Array<{ metadata: unknown }>>

/**
 * A person (not the AI) wrote in this chat within `hours`: an outbound message whose metadata is not an AI send
 * (isSoftAiOutboundMetadata). Tenant-scoped. Server use only — the DB module is imported lazily so this file stays
 * client-safe (the inbox imports the pure helpers above). A read error counts as "a person wrote" (fail toward the
 * person: the AI never takes a chat it is not sure about).
 */
export async function humanWroteRecently(
  tenantId: string,
  conversationId: string,
  hours = 24,
  reader?: RecentOutboundReader,
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3_600_000)
  try {
    const read: RecentOutboundReader =
      reader ??
      (async (args) => {
        const { prisma } = await import('@/lib/db')
        return prisma.chatMessage.findMany({
          where: { tenantId: args.tenantId, conversationId: args.conversationId, direction: 'outbound', sentAt: { gte: args.since } },
          select: { metadata: true },
          orderBy: { sentAt: 'desc' },
          take: 50,
        })
      })
    const rows = await read({ tenantId, conversationId, since })
    return rows.some((r) => !isSoftAiOutboundMetadata(r.metadata))
  } catch {
    return true
  }
}
