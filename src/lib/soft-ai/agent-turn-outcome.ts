/**
 * Shared send / suggest / skip decision for live delivery and Probar.
 * Probar `wouldSend` is `outcome === 'send'` after the model, never before.
 */

import type { EffectiveAgentBehavior } from '@/lib/soft-ai/agent-types'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'

export type AgentTurnOutcomeName = 'send' | 'suggest' | 'skip'

export type AgentTurnOutcome = {
  outcome: AgentTurnOutcomeName
  reason: string | null
}

export type OutcomeMarkers = {
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
}

/**
 * Live checks Probar does not run. Informational only — never report them as passed.
 */
export const PROBAR_NOT_SIMULATED_GATES = [
  'token_health',
  'stale_version',
  'human_replied',
  'live_daily_cap',
] as const

/** Stable skip priority. `ai_full_not_unlocked` is suggest, not skip. */
const HARD_SKIP_REASONS = [
  'not_bound_to_channel',
  'flag_off',
  'account_not_allowlisted',
  'no_binding',
  'binding_inactive',
  'agent_not_live',
  'draft_agent',
  'model_not_allowed',
  'human_only',
  'schema_not_ready',
  'test_budget_blocked',
  'human_replied',
  'stale_version',
  'token_unhealthy',
  'window_closed',
  'budget_blocked',
  'superseded',
] as const

const SUGGEST_ONLY_BLOCKER = 'ai_full_not_unlocked'

export function behaviorForOperationMode(operationMode: string): EffectiveAgentBehavior {
  if (operationMode === 'ai_full') return 'send'
  if (operationMode === 'ai_suggest') return 'suggest'
  if (operationMode === 'human_only') return 'human_only'
  return 'human_only'
}

export function decideTurnOutcome(input: {
  effectiveBehavior: EffectiveAgentBehavior
  unlockedForSend: boolean
  needsHuman: boolean
  fallbackUsed: boolean
  escalate: boolean
  conversationAiMode: SoftAiAgentMode | null | undefined
  gateBlockers: readonly string[]
}): AgentTurnOutcome {
  const mode = input.conversationAiMode
  if (mode === 'paused') return { outcome: 'skip', reason: 'paused_before_send' }
  if (mode === 'human') return { outcome: 'skip', reason: 'human_before_send' }
  if (mode !== 'ai_active') return { outcome: 'skip', reason: 'missing_mode' }

  for (const reason of HARD_SKIP_REASONS) {
    if (input.gateBlockers.includes(reason)) return { outcome: 'skip', reason }
  }
  const other = input.gateBlockers.find((reason) => reason !== SUGGEST_ONLY_BLOCKER)
  if (other) return { outcome: 'skip', reason: other }

  if (input.fallbackUsed) return { outcome: 'suggest', reason: 'fallback_used' }
  if (input.needsHuman) return { outcome: 'suggest', reason: 'needs_human' }
  if (input.escalate) return { outcome: 'suggest', reason: 'escalate' }

  switch (input.effectiveBehavior) {
    case 'suggest':
      return { outcome: 'suggest', reason: 'ai_suggest' }
    case 'human_only':
      return { outcome: 'skip', reason: 'human_only' }
    case 'skip':
      return { outcome: 'skip', reason: 'human_only' }
    case 'send':
      if (!input.unlockedForSend || input.gateBlockers.includes(SUGGEST_ONLY_BLOCKER)) {
        return { outcome: 'suggest', reason: 'ai_full_not_unlocked' }
      }
      return { outcome: 'send', reason: null }
    default: {
      const _exhaustive: never = input.effectiveBehavior
      return { outcome: 'skip', reason: String(_exhaustive) }
    }
  }
}

export function readOutcomeMarkers(trace: unknown): OutcomeMarkers | null {
  if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return null
  const raw = (trace as { outcomeMarkers?: unknown }).outcomeMarkers
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (typeof row.needsHuman !== 'boolean') return null
  if (typeof row.fallbackUsed !== 'boolean') return null
  if (typeof row.escalate !== 'boolean') return null
  return {
    needsHuman: row.needsHuman,
    fallbackUsed: row.fallbackUsed,
    escalate: row.escalate,
  }
}

export function withOutcomeMarkers(trace: unknown, markers: OutcomeMarkers): unknown {
  if (trace && typeof trace === 'object' && !Array.isArray(trace)) {
    return { ...(trace as Record<string, unknown>), outcomeMarkers: markers }
  }
  return { outcomeMarkers: markers }
}
