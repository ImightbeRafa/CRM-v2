/**
 * Chat assignment rules + auto-close (Phase 2b, Config › Chats). Pure logic only; the sweep that
 * applies them lives in chat-workspace-sweep.ts. Everything is OFF by default per business.
 *
 * - round_robin: next teammate after the last one who got a chat (list order).
 * - workload: the teammate with the fewest open chats (ties → list order).
 * - business hours: outside them nothing is assigned; chats wait for opening time.
 */
export type AssignmentMode = 'off' | 'round_robin' | 'workload'
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]
/** `{ mon: [['09:00','18:00']], … }`; an empty object means "always open". */
export type BusinessHours = Partial<Record<Weekday, Array<[string, string]>>>

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export function parseAssignmentMode(v: unknown): AssignmentMode | null {
  return v === 'off' || v === 'round_robin' || v === 'workload' ? v : null
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function validateBusinessHours(input: unknown): { ok: true; hours: BusinessHours } | { ok: false; error: string } {
  if (input === null || input === undefined) return { ok: true, hours: {} }
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Horario inválido' }
  const out: BusinessHours = {}
  for (const [day, ranges] of Object.entries(input as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(day)) return { ok: false, error: `Día inválido: ${day}` }
    if (ranges === null || ranges === undefined) continue
    if (!Array.isArray(ranges) || ranges.length > 4) return { ok: false, error: 'Máximo 4 franjas por día' }
    const list: Array<[string, string]> = []
    for (const r of ranges) {
      if (!Array.isArray(r) || r.length !== 2 || !HHMM.test(String(r[0])) || !HHMM.test(String(r[1]))) {
        return { ok: false, error: 'Usá horas como 09:00' }
      }
      if (String(r[0]) >= String(r[1])) return { ok: false, error: 'La hora de cierre debe ser después de la de apertura' }
      list.push([String(r[0]), String(r[1])])
    }
    if (list.length) out[day as Weekday] = list
  }
  // Hours turned on but every day closed would silently mean "always open": refuse it.
  if (Object.keys(input as object).length > 0 && Object.keys(out).length === 0) {
    return { ok: false, error: 'Marcá al menos un día de atención (o apagá el horario).' }
  }
  return { ok: true, hours: out }
}

/** Weekday + HH:mm of `now` in the business's timezone. */
export function localDayAndTime(now: Date, tz: string): { day: Weekday; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const day = get('weekday').slice(0, 3).toLowerCase() as Weekday
  return { day, time: `${get('hour').padStart(2, '0')}:${get('minute').padStart(2, '0')}` }
}

export function isWithinBusinessHours(hours: BusinessHours | null | undefined, tz: string, now: Date = new Date()): boolean {
  if (!hours || Object.keys(hours).length === 0) return true
  const { day, time } = localDayAndTime(now, isValidTimezone(tz) ? tz : 'America/Costa_Rica')
  const ranges = hours[day]
  if (!ranges?.length) return false
  return ranges.some(([from, to]) => time >= from && time < to)
}

/** Next teammate after `cursor` (list order, wraps). */
export function pickRoundRobin(candidates: string[], cursor: string | null): string | null {
  if (!candidates.length) return null
  const i = cursor ? candidates.indexOf(cursor) : -1
  return candidates[(i + 1) % candidates.length]
}

/** Fewest open chats; ties keep list order. */
export function pickByWorkload(candidates: string[], loads: Map<string, number>): string | null {
  let best: string | null = null
  let bestLoad = Infinity
  for (const c of candidates) {
    const l = loads.get(c) ?? 0
    if (l < bestLoad) {
      best = c
      bestLoad = l
    }
  }
  return best
}

export type WorkspaceSettingsInput = {
  assignmentMode: AssignmentMode
  assigneeUserIds: string[]
  skipAiActive: boolean
  businessHours: BusinessHours
  timezone: string
  autoCloseDays: number | null
  autoCloseStageKey: string | null
  reopenOnInbound: boolean
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsInput = {
  assignmentMode: 'off',
  assigneeUserIds: [],
  skipAiActive: true,
  businessHours: {},
  timezone: 'America/Costa_Rica',
  autoCloseDays: null,
  autoCloseStageKey: null,
  reopenOnInbound: false,
}

/**
 * Validates the Config › Chats form. `closedStageKeys` = active won/lost chat stages of the business.
 * Auto-close forces reopen-on-inbound (a customer writing to an auto-closed chat must be seen).
 */
export function validateWorkspaceSettings(
  input: unknown,
  closedStageKeys: string[],
): { ok: true; settings: WorkspaceSettingsInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Datos inválidos' }
  const raw = input as Record<string, unknown>
  const mode = parseAssignmentMode(raw.assignmentMode ?? 'off')
  if (!mode) return { ok: false, error: 'Modo de asignación inválido' }
  const ids = Array.isArray(raw.assigneeUserIds) ? raw.assigneeUserIds.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v)) : []
  const assigneeUserIds = [...new Set(ids)].slice(0, 100)
  if (mode !== 'off' && assigneeUserIds.length === 0) return { ok: false, error: 'Elegí al menos una persona para repartir chats' }
  const hours = validateBusinessHours(raw.businessHours)
  if (!hours.ok) return hours
  const timezone = raw.timezone === undefined ? 'America/Costa_Rica' : raw.timezone
  if (!isValidTimezone(timezone)) return { ok: false, error: 'Zona horaria inválida' }
  let autoCloseDays: number | null = null
  if (raw.autoCloseDays !== null && raw.autoCloseDays !== undefined && raw.autoCloseDays !== '') {
    const n = Number(raw.autoCloseDays)
    if (!Number.isInteger(n) || n < 1 || n > 365) return { ok: false, error: 'Cerrar después de 1 a 365 días' }
    autoCloseDays = n
  }
  let autoCloseStageKey: string | null = null
  if (autoCloseDays !== null) {
    const key = typeof raw.autoCloseStageKey === 'string' ? raw.autoCloseStageKey : closedStageKeys[0]
    if (!key || !closedStageKeys.includes(key)) return { ok: false, error: 'Elegí una etapa de cierre válida' }
    autoCloseStageKey = key
  }
  const reopenOnInbound = autoCloseDays !== null ? true : raw.reopenOnInbound === true
  return {
    ok: true,
    settings: {
      assignmentMode: mode,
      assigneeUserIds,
      skipAiActive: raw.skipAiActive !== false,
      businessHours: hours.hours,
      timezone,
      autoCloseDays,
      autoCloseStageKey,
      reopenOnInbound,
    },
  }
}
