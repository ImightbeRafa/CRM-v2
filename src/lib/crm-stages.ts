/**
 * Stage definitions shared by server and client (Phase 2a, 2026-09-29). No server imports.
 *
 * Two pipelines:
 * - 'chat': a conversation's status. System keys nuevo / en_curso / hecho can be relabelled but
 *   never deleted or re-keyed (automatic moves and the webhook depend on them).
 * - 'client': a client's lifecycle, computed from orders (src/lib/crm-client-stage.ts). Default
 *   list from Rafael: Nuevo lead → Cotizando → Esperando pago → Pagado → En producción → Enviado →
 *   Entregado → Recurrente (a client who purchased more than once).
 *
 * Every stage has a category: open / won / lost. "Closed" (won or lost) chats leave the Abiertos
 * bucket, like "hecho" always did. `targetMinutes` and `entryRules` are there for tuning later.
 */
export type StagePipeline = 'chat' | 'client'
export type StageCategory = 'open' | 'won' | 'lost'

export type StageDef = {
  key: string
  label: string
  color: string | null
  position: number
  category: StageCategory
  targetMinutes: number | null
  isSystem: boolean
  archived: boolean
}

export type TagDef = { key: string; label: string; color: string | null; position: number; isSystem: boolean; archived: boolean }

export const STAGE_KEY_RE = /^[a-z0-9_]{1,40}$/
export const STAGE_COLORS = ['slate', 'sky', 'violet', 'amber', 'emerald', 'rose', 'orange', 'teal'] as const

export const CHAT_SYSTEM_STAGE_KEYS = ['nuevo', 'en_curso', 'hecho'] as const

export const DEFAULT_CHAT_STAGES: StageDef[] = [
  { key: 'nuevo', label: 'Nuevo', color: 'slate', position: 0, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'en_curso', label: 'En curso', color: 'sky', position: 1, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'hecho', label: 'Hecho', color: 'emerald', position: 2, category: 'won', targetMinutes: null, isSystem: true, archived: false },
]

export const DEFAULT_CLIENT_STAGES: StageDef[] = [
  { key: 'nuevo_lead', label: 'Nuevo lead', color: 'slate', position: 0, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'cotizando', label: 'Cotizando', color: 'sky', position: 1, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'esperando_pago', label: 'Esperando pago', color: 'amber', position: 2, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'pagado', label: 'Pagado', color: 'teal', position: 3, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'en_produccion', label: 'En producción', color: 'violet', position: 4, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'enviado', label: 'Enviado', color: 'orange', position: 5, category: 'open', targetMinutes: null, isSystem: true, archived: false },
  { key: 'entregado', label: 'Entregado', color: 'emerald', position: 6, category: 'won', targetMinutes: null, isSystem: true, archived: false },
  { key: 'recurrente', label: 'Recurrente', color: 'rose', position: 7, category: 'won', targetMinutes: null, isSystem: true, archived: false },
]

export const DEFAULT_CHAT_TAGS: TagDef[] = [
  { key: 'Envío', label: 'Envío', color: 'sky', position: 0, isSystem: true, archived: false },
  { key: 'VIP', label: 'VIP', color: 'amber', position: 1, isSystem: true, archived: false },
  { key: 'Nuevo', label: 'Nuevo', color: 'emerald', position: 2, isSystem: true, archived: false },
]

export function defaultStages(pipeline: StagePipeline): StageDef[] {
  return (pipeline === 'chat' ? DEFAULT_CHAT_STAGES : DEFAULT_CLIENT_STAGES).map((s) => ({ ...s }))
}

export function isClosedCategory(category: StageCategory | null | undefined): boolean {
  return category === 'won' || category === 'lost'
}

/** Unknown keys (e.g. a stage archived after chats used it) count as open, never hidden. */
export function stageCategoryOf(stages: StageDef[], key: string | null | undefined): StageCategory {
  if (!key) return 'open'
  return stages.find((s) => s.key === key)?.category ?? (key === 'hecho' ? 'won' : 'open')
}

export function stageLabelOf(stages: StageDef[], key: string | null | undefined): string {
  if (!key) return ''
  const found = stages.find((s) => s.key === key)
  if (found) return found.archived ? `${found.label} (archivada)` : found.label
  return key.replace(/_/g, ' ')
}

/** Turns a free label into a stable key: "Esperando depósito" → "esperando_deposito". */
export function stageKeyFromLabel(label: string): string {
  const base = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return base || 'etapa'
}

export type StageInput = {
  key?: unknown
  label?: unknown
  color?: unknown
  category?: unknown
  targetMinutes?: unknown
  archived?: unknown
}

/**
 * Validates a full stage list for a pipeline. System stages of the default list must stay (they
 * may be relabelled / recoloured / reordered, and chat system stages keep their category).
 */
export function validateStageList(
  pipeline: StagePipeline,
  input: unknown,
): { ok: true; stages: StageDef[] } | { ok: false; error: string } {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: 'La lista de etapas está vacía.' }
  if (input.length > 30) return { ok: false, error: 'Máximo 30 etapas.' }
  const defaults = defaultStages(pipeline)
  const seen = new Set<string>()
  const out: StageDef[] = []
  for (const [i, raw] of (input as StageInput[]).entries()) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    if (!label || label.length > 40) return { ok: false, error: `Etapa ${i + 1}: el nombre debe tener entre 1 y 40 caracteres.` }
    const key = typeof raw?.key === 'string' && raw.key ? raw.key : stageKeyFromLabel(label)
    if (!STAGE_KEY_RE.test(key)) return { ok: false, error: `Etapa "${label}": clave inválida.` }
    if (seen.has(key)) return { ok: false, error: `Etapa "${label}": está repetida.` }
    seen.add(key)
    const sys = defaults.find((d) => d.key === key)
    const category: StageCategory =
      pipeline === 'chat' && sys ? sys.category
        : raw?.category === 'won' || raw?.category === 'lost' ? raw.category : 'open'
    const color = typeof raw?.color === 'string' && (STAGE_COLORS as readonly string[]).includes(raw.color) ? raw.color : null
    const t = raw?.targetMinutes
    const targetMinutes = typeof t === 'number' && Number.isInteger(t) && t > 0 && t <= 60 * 24 * 365 ? t : null
    const archived = sys ? false : raw?.archived === true
    out.push({ key, label, color, position: i, category, targetMinutes, isSystem: Boolean(sys), archived })
  }
  for (const d of defaults) {
    if (!seen.has(d.key)) return { ok: false, error: `La etapa del sistema "${d.label}" no se puede borrar (sí renombrar).` }
  }
  if (!out.some((s) => !s.archived && s.category === 'open')) return { ok: false, error: 'Debe quedar al menos una etapa abierta.' }
  return { ok: true, stages: out }
}

export function validateTagList(input: unknown): { ok: true; tags: TagDef[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Lista de etiquetas inválida.' }
  if (input.length > 50) return { ok: false, error: 'Máximo 50 etiquetas.' }
  const seen = new Set<string>()
  const out: TagDef[] = []
  for (const [i, raw] of (input as Array<{ key?: unknown; label?: unknown; color?: unknown; archived?: unknown }>).entries()) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    if (!label || label.length > 40) return { ok: false, error: `Etiqueta ${i + 1}: el nombre debe tener entre 1 y 40 caracteres.` }
    // Tag keys are what ChatConversation.tags stores: legacy keys ('Envío', 'VIP', 'Nuevo') stay.
    const key = typeof raw?.key === 'string' && raw.key.trim() ? raw.key.trim().slice(0, 40) : label
    if (seen.has(key.toLowerCase())) return { ok: false, error: `Etiqueta "${label}": está repetida.` }
    seen.add(key.toLowerCase())
    const color = typeof raw?.color === 'string' && (STAGE_COLORS as readonly string[]).includes(raw.color) ? raw.color : null
    const isSystem = DEFAULT_CHAT_TAGS.some((d) => d.key === key)
    out.push({ key, label, color, position: i, isSystem, archived: raw?.archived === true })
  }
  return { ok: true, tags: out }
}
