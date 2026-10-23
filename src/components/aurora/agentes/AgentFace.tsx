import { AgentMark } from '@/components/brand/AgentMark'
import type { BetsyState } from '@/components/brand/BetsyMark'
import { resolveAgentAppearance, type AgentAppearance } from '@/lib/agent-appearance'

export type FaceSource = {
  id?: string | null
  name: string
  introductionNames?: ReadonlyArray<string> | null
  /** Saved appearance (plate, ring, display name); missing = deterministic default. */
  appearance?: Partial<AgentAppearance> | null
}

/** "Sofi · Ventas tienda": display name (saved, else `introductionNames[0]`, never literals) + internal name. */
export function agentTitleParts(a: FaceSource): { persona: string | null; internal: string } {
  const internal = a.name.trim() || 'Agente'
  const persona = resolveAgentAppearance(a, a.appearance).displayName
  // Avoid "Ventas · Ventas" when both are the same word.
  if (persona && persona.toLowerCase() === internal.toLowerCase()) return { persona: null, internal }
  return { persona, internal }
}

export function agentTitle(a: FaceSource): string {
  const { persona, internal } = agentTitleParts(a)
  return persona ? `${persona} · ${internal}` : internal
}

/**
 * The agent's face: the official Betsy mark on its own colored plate ("costume").
 * Lists keep plates still except the hovered / focused card (listen); drafts show the paused mark.
 */
export function AgentFace({
  agent,
  size = 48,
  state = 'idle',
  animated = true,
}: {
  agent: FaceSource
  size?: number
  state?: BetsyState
  animated?: boolean
}) {
  return <AgentMark appearance={resolveAgentAppearance(agent, agent.appearance)} size={size} state={state} animated={animated} />
}
