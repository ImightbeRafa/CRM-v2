/**
 * Agentes · URL state for `/config?tab=agentes&agente=<id|slug>&seccion=<key>[&card=<id>]` (pure).
 * `agente=<id>` is canonical; a slug (slugified agent name) is accepted and replaced by the id.
 */

export type AgentTab =
  | 'resumen'
  | 'personalidad'
  | 'conocimiento'
  | 'herramientas'
  | 'canales'
  | 'historial'
  | 'seguridad'

/** Figma order. `canales` is the live key; its label is "Líneas". Seguridad is the extra 7th tab. */
export const AGENT_SECTIONS: ReadonlyArray<{ key: AgentTab; label: string }> = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'personalidad', label: 'Personalidad' },
  { key: 'conocimiento', label: 'Conocimiento' },
  { key: 'herramientas', label: 'Herramientas' },
  { key: 'canales', label: 'Líneas' },
  { key: 'historial', label: 'Historial' },
  { key: 'seguridad', label: 'Seguridad' },
]

export const DEFAULT_AGENT_TAB: AgentTab = 'resumen'

/** Tabs a not-yet-saved agent can use (everything else needs an id). */
export const DRAFT_ENABLED_TABS: ReadonlyArray<AgentTab> = ['resumen', 'personalidad', 'canales']

const KEYS = new Set<string>(AGENT_SECTIONS.map((s) => s.key))

function fold(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** True when `raw` is a live key or a known alias (`lineas`). */
export function isKnownSeccion(raw: string | null | undefined): boolean {
  if (!raw) return false
  const v = fold(raw)
  return KEYS.has(v) || v === 'lineas'
}

/** Valid key → key; `lineas` / `líneas` → `canales`; anything else → `resumen`. */
export function normalizeSeccion(raw: string | null | undefined): AgentTab {
  if (!raw) return DEFAULT_AGENT_TAB
  const v = fold(raw)
  if (v === 'lineas') return 'canales'
  return KEYS.has(v) ? (v as AgentTab) : DEFAULT_AGENT_TAB
}

export function agentTabLabel(tab: AgentTab): string {
  return AGENT_SECTIONS.find((s) => s.key === tab)?.label ?? 'Resumen'
}

/** NFD, strip accents, lowercase, non-alphanumerics → "-", trim "-". */
export function slugifyAgentName(name: string): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export type AgentParamResolution =
  | { kind: 'id'; id: string }
  | { kind: 'slug'; id: string }
  | { kind: 'ambiguous' }
  | { kind: 'none' }

/**
 * Exact id wins. Otherwise exactly one slug match → `slug` (caller replaces the URL with the id);
 * several → `ambiguous`; no match / empty → `none`.
 */
export function resolveAgentParam(
  param: string | null | undefined,
  agents: ReadonlyArray<{ id: string; name: string }>,
): AgentParamResolution {
  const raw = (param ?? '').trim()
  if (!raw) return { kind: 'none' }
  if (agents.some((a) => a.id === raw)) return { kind: 'id', id: raw }
  const slug = slugifyAgentName(raw)
  if (!slug) return { kind: 'none' }
  const matches = agents.filter((a) => slugifyAgentName(a.name) === slug)
  if (matches.length === 1) return { kind: 'slug', id: matches[0].id }
  return matches.length > 1 ? { kind: 'ambiguous' } : { kind: 'none' }
}

export function buildAgentHref(input: { agente?: string | null; seccion?: AgentTab | null; card?: string | null } = {}): string {
  const parts = ['tab=agentes']
  if (input.agente) parts.push(`agente=${encodeURIComponent(input.agente)}`)
  if (input.seccion) parts.push(`seccion=${encodeURIComponent(input.seccion)}`)
  if (input.card) parts.push(`card=${encodeURIComponent(input.card)}`)
  return `/config?${parts.join('&')}`
}
