import { BetsyAvatar, personaName, type AvatarMood } from '@/components/brand/betsy-avatar'

type FaceSource = { id?: string | null; name: string; introductionNames?: ReadonlyArray<string> | null }

/** "Sofi · Ventas tienda": persona name from `introductionNames[0]` (data, never literals) + internal name. */
export function agentTitleParts(a: FaceSource): { persona: string | null; internal: string } {
  const internal = a.name.trim() || 'Agente'
  const persona = personaName(a)
  // Avoid "Ventas · Ventas" when both are the same word.
  if (persona && persona.toLowerCase() === internal.toLowerCase()) return { persona: null, internal }
  return { persona, internal }
}

export function agentTitle(a: FaceSource): string {
  const { persona, internal } = agentTitleParts(a)
  return persona ? `${persona} · ${internal}` : internal
}

/** The agent's Betsy-family face: deterministic from its id + customer-facing name. Decorative next to its name. */
export function AgentFace({
  agent,
  size = 48,
  mood = 'idle',
  motion = 'hover',
}: {
  agent: FaceSource
  size?: number
  mood?: AvatarMood
  /** Lists animate only on hover / for the selected card; headers animate always. */
  motion?: 'always' | 'hover'
}) {
  return <BetsyAvatar agent={agent} size={size} mood={mood} motion={motion} label="" />
}
