/**
 * Inbox trust-label projection for Soft Agent Layer (data components only).
 */

import type { ChatAgentOperationMode } from '@/lib/soft-ai/agent-types'

export type AgentStateDot = 'IA' | 'Sug' | 'Hum'

export function formatAgentHeaderLabel(input: {
  emoji?: string | null
  name?: string | null
  operationMode?: ChatAgentOperationMode | string | null
}): string {
  if (!input.name) return 'Sin agente'
  const mode =
    input.operationMode === 'ai_full'
      ? 'Responder'
      : input.operationMode === 'human_only'
        ? 'Solo humanos'
        : input.operationMode === 'ai_suggest'
          ? 'Sugerir'
          : 'Sugerir'
  return `Agente: ${input.emoji || '✨'} ${input.name} · ${mode}`
}

export function agentStateDot(input: {
  operationMode?: ChatAgentOperationMode | string | null
  conversationAiMode?: string | null
}): AgentStateDot {
  if (
    input.conversationAiMode === 'human' ||
    input.conversationAiMode === 'paused' ||
    input.operationMode === 'human_only'
  ) {
    return 'Hum'
  }
  if (input.operationMode === 'ai_suggest') return 'Sug'
  if (input.operationMode === 'ai_full') return 'IA'
  return 'Hum'
}

export function isSoftAiOutboundMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  return (metadata as Record<string, unknown>).softAi === true
}

function snapshotText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Historical outbound label for a delivered bubble.
 * Agent-layer sends are named from the metadata snapshot (`agentId` + `agentName`).
 * Legacy Soft AI, and any row without that snapshot, stays "IA envió".
 * Callers must not pass the current binding — names change after the send.
 */
export function softAiOutboundLabel(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return 'IA envió'
  const meta = metadata as Record<string, unknown>
  if (meta.softAi !== true) return 'IA envió'
  const agentId = snapshotText(meta.agentId)
  const agentName = snapshotText(meta.agentName)
  if (!agentId || !agentName) return 'IA envió'
  const agentEmoji = snapshotText(meta.agentEmoji)
  return agentEmoji ? `${agentEmoji} ${agentName} envió` : `${agentName} envió`
}
