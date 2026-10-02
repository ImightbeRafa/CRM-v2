/**
 * Chat automation rules v1 (pure): validation and matching. INTERNAL actions only — a rule can tag a
 * chat, assign it, or create a follow-up task. It can never send a message to a customer, and no
 * trigger reacts to the effects of an action (no tag/assignee trigger), so rules cannot loop.
 */

export const TRIGGER_KINDS = ['new_chat', 'idle', 'keyword'] as const
export const ACTION_KINDS = ['tag', 'assign', 'task'] as const
export type TriggerKind = (typeof TRIGGER_KINDS)[number]
export type ActionKind = (typeof ACTION_KINDS)[number]

export const MAX_RULES_PER_TENANT = 20
export const MAX_CANDIDATES_PER_RULE = 50
export const MAX_ACTIONS_PER_TENANT_PER_RUN = 100
export const IDLE_MIN_MINUTES = 5
export const IDLE_MAX_MINUTES = 10_080
export const TAG_MAX = 30
export const TASK_TITLE_MAX = 200

export type TriggerConfig = { minutes?: number; keywords?: string[] }
export type ActionConfig = { tag?: string; userId?: string; title?: string; dueInMinutes?: number | null }

export type RuleInput = {
  name: string
  enabled: boolean
  triggerKind: TriggerKind
  triggerConfig: TriggerConfig
  actionKind: ActionKind
  actionConfig: ActionConfig
}

export type RuleParse = { ok: true; rule: RuleInput } | { ok: false; error: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

export function parseRuleInput(body: unknown): RuleParse {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON requerido' }
  const b = body as Record<string, unknown>
  const name = str(b.name)
  if (!name || name.length > 60) return { ok: false, error: 'El nombre es obligatorio (máx. 60 caracteres).' }
  const triggerKind = b.triggerKind as TriggerKind
  if (!(TRIGGER_KINDS as readonly unknown[]).includes(triggerKind)) return { ok: false, error: 'Disparador inválido.' }
  const actionKind = b.actionKind as ActionKind
  if (!(ACTION_KINDS as readonly unknown[]).includes(actionKind)) return { ok: false, error: 'Acción inválida.' }

  const tc = (b.triggerConfig && typeof b.triggerConfig === 'object' ? b.triggerConfig : {}) as Record<string, unknown>
  const triggerConfig: TriggerConfig = {}
  if (triggerKind === 'idle') {
    const minutes = Math.floor(Number(tc.minutes))
    if (!Number.isFinite(minutes) || minutes < IDLE_MIN_MINUTES || minutes > IDLE_MAX_MINUTES) {
      return { ok: false, error: `Los minutos sin respuesta van de ${IDLE_MIN_MINUTES} a ${IDLE_MAX_MINUTES}.` }
    }
    triggerConfig.minutes = minutes
  }
  if (triggerKind === 'keyword') {
    const raw = Array.isArray(tc.keywords) ? tc.keywords : []
    const keywords = [...new Set(raw.map(str).filter((k) => k.length >= 2 && k.length <= 40))].slice(0, 10)
    if (keywords.length === 0) return { ok: false, error: 'Agregá al menos una palabra (2 a 40 caracteres).' }
    triggerConfig.keywords = keywords
  }

  const ac = (b.actionConfig && typeof b.actionConfig === 'object' ? b.actionConfig : {}) as Record<string, unknown>
  const actionConfig: ActionConfig = {}
  if (actionKind === 'tag') {
    const tag = str(ac.tag).replace(/[,\n\r]/g, ' ').replace(/\s+/g, ' ')
    if (!tag || tag.length > TAG_MAX) return { ok: false, error: `La etiqueta es obligatoria (máx. ${TAG_MAX} caracteres).` }
    actionConfig.tag = tag
  }
  if (actionKind === 'assign') {
    const userId = str(ac.userId)
    if (!userId || userId.length > 80) return { ok: false, error: 'Elegí a quién asignar.' }
    actionConfig.userId = userId
  }
  if (actionKind === 'task') {
    const title = str(ac.title)
    if (!title || title.length > TASK_TITLE_MAX) return { ok: false, error: `El título de la tarea es obligatorio (máx. ${TASK_TITLE_MAX}).` }
    actionConfig.title = title
    if (ac.dueInMinutes !== undefined && ac.dueInMinutes !== null && ac.dueInMinutes !== '') {
      const due = Math.floor(Number(ac.dueInMinutes))
      if (!Number.isFinite(due) || due < 0 || due > 43_200) return { ok: false, error: 'El plazo de la tarea es inválido.' }
      actionConfig.dueInMinutes = due
    }
  }
  return {
    ok: true,
    rule: { name, enabled: b.enabled === true, triggerKind, triggerConfig, actionKind, actionConfig },
  }
}

/** Lowercase, no accents, single spaces: "¿Cuánto   SALE?" → "¿cuanto sale?". */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchesKeyword(content: string, keywords: readonly string[]): boolean {
  const hay = normalizeText(content)
  if (!hay) return false
  return keywords.some((k) => {
    const needle = normalizeText(k)
    return needle.length >= 2 && hay.includes(needle)
  })
}

export function idleDedupeKey(lastInboundAt: Date): string {
  return `idle:${lastInboundAt.getTime()}`
}

/** True when the customer wrote last and nobody (human or agent) answered after it. */
export function isAwaitingReply(c: { lastInboundAt: Date | null; lastOutboundAt: Date | null }): boolean {
  if (!c.lastInboundAt) return false
  return !c.lastOutboundAt || c.lastOutboundAt.getTime() < c.lastInboundAt.getTime()
}

export const NEW_CHAT_WINDOW_MS = 15 * 60_000
export const KEYWORD_WINDOW_MS = 10 * 60_000
/** An idle rule fires when the threshold was crossed within this window (never on old backlog). */
export const IDLE_FIRE_WINDOW_MS = 120 * 60_000
