/**
 * Soft Tenant AI agent state — mode + tool log per conversation.
 * Client localStorage for Soft UI / DEMO. Never writes production ChatMessage
 * for DEMO. Server control API can mirror for flagged tenants later.
 */

import type { SoftAiAgentMode, SoftAiToolLogEntry } from '@/lib/soft-ai/types'

export const SOFT_AI_AGENT_STATE_KEY = 'betsy.softCopilot.agentState.v1'

export type SoftAiConversationState = {
  mode: SoftAiAgentMode
  toolLog: SoftAiToolLogEntry[]
  /** Last AI reply id (demo message id) if any. */
  lastAiMessageId?: string
  updatedAt: string
}

export type SoftAiAgentStateMap = Record<string, SoftAiConversationState>

export function defaultAgentMode(isDemo?: boolean): SoftAiAgentMode {
  // Soft DEMO / QA: AI on by default. Production Soft chrome starts ai_active
  // only when the tenant flag is on (UI still shows controls).
  return isDemo ? 'ai_active' : 'ai_active'
}

export function readAgentStateMap(): SoftAiAgentStateMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SOFT_AI_AGENT_STATE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SoftAiAgentStateMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeAgentStateMap(map: SoftAiAgentStateMap) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOFT_AI_AGENT_STATE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota
  }
}

export function getConversationAgentState(
  map: SoftAiAgentStateMap,
  key: string,
  isDemo?: boolean,
): SoftAiConversationState {
  const existing = map[key]
  if (existing) return existing
  return {
    mode: defaultAgentMode(isDemo),
    toolLog: [],
    updatedAt: new Date().toISOString(),
  }
}

export function applyAgentControl(
  map: SoftAiAgentStateMap,
  key: string,
  action: 'take_over' | 'pause' | 'resume',
  isDemo?: boolean,
): SoftAiAgentStateMap {
  const prev = getConversationAgentState(map, key, isDemo)
  let mode: SoftAiAgentMode = prev.mode
  if (action === 'take_over') mode = 'human'
  else if (action === 'pause') mode = 'paused'
  else if (action === 'resume') mode = 'ai_active'
  else {
    const _exhaustive: never = action
    void _exhaustive
  }
  return {
    ...map,
    [key]: {
      ...prev,
      mode,
      updatedAt: new Date().toISOString(),
    },
  }
}

export function appendToolLog(
  map: SoftAiAgentStateMap,
  key: string,
  entries: SoftAiToolLogEntry[],
  extras?: Partial<SoftAiConversationState>,
  isDemo?: boolean,
): SoftAiAgentStateMap {
  const prev = getConversationAgentState(map, key, isDemo)
  return {
    ...map,
    [key]: {
      ...prev,
      ...extras,
      toolLog: [...prev.toolLog, ...entries].slice(-40),
      updatedAt: new Date().toISOString(),
    },
  }
}

export function agentModeLabel(mode: SoftAiAgentMode): string {
  if (mode === 'ai_active') return 'IA activa'
  if (mode === 'paused') return 'IA pausada'
  if (mode === 'human') return 'Humano'
  const _exhaustive: never = mode
  return _exhaustive
}
