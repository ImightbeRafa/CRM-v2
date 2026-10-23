/**
 * Agent "costume" (HANDOFF.md + research: one fixed character, costumes instead of new characters):
 * the official BetsyMark never changes; each agent gets a colored plate, an optional ring and its
 * customer-facing display name. Pure data: safe for server code, routes, tests and client UI.
 * Owner choices are stored per agent (see `parseAgentAppearance`); missing values fall back to a
 * deterministic default, so agents without a saved appearance still look distinct.
 */

export const AGENT_PLATES = ['indigo', 'violet', 'sky', 'teal', 'green', 'amber', 'rose', 'slate'] as const
export type AgentPlate = (typeof AGENT_PLATES)[number]

export const AGENT_PLATE_LABELS: Record<AgentPlate, string> = {
  indigo: 'Índigo',
  violet: 'Violeta',
  sky: 'Cielo',
  teal: 'Turquesa',
  green: 'Verde',
  amber: 'Ámbar',
  rose: 'Rosa',
  slate: 'Gris',
}

export type AgentAppearance = {
  plate: AgentPlate
  ring: boolean
  /** UI-only label (never sent to customers); null = use the first introduction name. */
  displayName: string | null
}

export const DISPLAY_NAME_MAX = 40

/** Tolerant parse: anything unknown or missing becomes null (caller falls back to the default). */
export function parseAgentAppearance(raw: unknown): Partial<AgentAppearance> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: Partial<AgentAppearance> = {}
  if (typeof r.plate === 'string' && (AGENT_PLATES as readonly string[]).includes(r.plate)) out.plate = r.plate as AgentPlate
  if (typeof r.ring === 'boolean') out.ring = r.ring
  if (typeof r.displayName === 'string') {
    // Control and BiDi override characters out (it is rendered as text next to the internal name).
    const name = r.displayName.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, DISPLAY_NAME_MAX)
    out.displayName = name || null
  } else if (r.displayName === null) out.displayName = null
  return Object.keys(out).length ? out : null
}

/** "Andrés " → "andres". */
export function normalizePersonaName(name: string): string {
  return name
    .trim()
    .split(/\s+/)[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** FNV-1a 32-bit: tiny, stable across runtimes. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Defaults for the live personas, by customer-facing first name (no store names here). */
const PERSONA_PLATES: Record<string, AgentPlate> = {
  betsy: 'indigo',
  sofi: 'teal',
  vale: 'violet',
  laura: 'rose',
  andres: 'amber',
  dani: 'sky',
  caro: 'green',
}

export type AgentIdentitySource = {
  id?: string | null
  name?: string | null
  introductionNames?: ReadonlyArray<string> | null
}

/** First non-empty customer-facing name, or null. */
export function personaName(src: AgentIdentitySource): string | null {
  const first = (src.introductionNames ?? []).map((n) => n.trim()).find(Boolean)
  return first || null
}

/** Saved appearance over the deterministic default (persona name → curated plate, else a hash). */
export function resolveAgentAppearance(src: AgentIdentitySource, saved?: Partial<AgentAppearance> | null): AgentAppearance {
  const persona = personaName(src)
  const key = persona ? normalizePersonaName(persona) : ''
  // Seeded by the customer-facing name first, so a draft preview and the saved agent match.
  const seed = String(persona || src.name?.trim() || src.id || 'betsy').toLowerCase()
  const fallback = PERSONA_PLATES[key] ?? AGENT_PLATES[stableHash(seed) % AGENT_PLATES.length]
  return {
    plate: saved?.plate ?? fallback,
    ring: saved?.ring ?? false,
    displayName: saved?.displayName ?? persona,
  }
}
