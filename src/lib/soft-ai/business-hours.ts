/**
 * agents2-hours (Rafael 2026-10-16): "Horario de atención" per agent line. Default OFF = 24/7 (no behaviour change).
 * Costa Rica time (America/Costa_Rica = UTC-6 all year, no daylight saving). Weekly windows; a window whose close is
 * at or before its open runs past midnight ("20:00–02:00"). Pure and client-safe (live turn, Probar, settings UI).
 *
 * After hours the agent still sells and answers; code adds a prompt line and swaps the customer text of a TRUE
 * hand-off for an after-hours variant (the team answers at the next opening); team alerts are created but quiet.
 */
import { z } from 'zod'

export const BUSINESS_HOURS_TIMEZONE = 'America/Costa_Rica'
/** Costa Rica has no daylight saving: UTC-6 all year. */
const CR_OFFSET_MS = -6 * 60 * 60_000
const DAY_MIN = 1440
const WEEK_MIN = 7 * DAY_MIN
export const MAX_WINDOWS_PER_DAY = 3
export const AFTER_HOURS_NOTE_MAX = 200

const HHMM_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const CLOSE_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/

export const businessHoursWindowSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    open: z.string().regex(HHMM_RE),
    close: z.string().regex(CLOSE_RE),
  })
  .refine((w) => w.open !== w.close, { message: 'open_equals_close' })

export const businessHoursSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.literal(BUSINESS_HOURS_TIMEZONE).default(BUSINESS_HOURS_TIMEZONE),
    windows: z.array(businessHoursWindowSchema).max(7 * MAX_WINDOWS_PER_DAY),
    afterHoursNote: z.string().trim().max(AFTER_HOURS_NOTE_MAX).nullable().optional(),
  })
  .refine((h) => [0, 1, 2, 3, 4, 5, 6].every((d) => h.windows.filter((w) => w.day === d).length <= MAX_WINDOWS_PER_DAY), {
    message: 'too_many_windows',
  })

export type BusinessHoursWindow = z.infer<typeof businessHoursWindowSchema>
export type BusinessHours = {
  enabled: boolean
  timezone: typeof BUSINESS_HOURS_TIMEZONE
  windows: BusinessHoursWindow[]
  afterHoursNote?: string | null
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = { enabled: false, timezone: BUSINESS_HOURS_TIMEZONE, windows: [], afterHoursNote: null }

/** Stored value: anything invalid / missing = off (24/7). */
export function parseBusinessHours(raw: unknown): BusinessHours {
  const parsed = businessHoursSchema.safeParse(raw)
  if (!parsed.success) return { ...DEFAULT_BUSINESS_HOURS }
  const note = parsed.data.afterHoursNote?.trim()
  return { enabled: parsed.data.enabled, timezone: BUSINESS_HOURS_TIMEZONE, windows: parsed.data.windows, afterHoursNote: note ? note : null }
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Costa Rica wall clock for an instant: weekday (0 = domingo) and minute of the day. */
export function crClock(now: Date): { day: number; minute: number; minuteOfWeek: number } {
  const local = new Date(now.getTime() + CR_OFFSET_MS)
  const day = local.getUTCDay()
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes()
  return { day, minute, minuteOfWeek: day * DAY_MIN + minute }
}

/** [start, end) in minutes of the week (end may pass the week's end: overnight Saturday → Sunday). */
function spans(windows: BusinessHoursWindow[]): Array<[number, number]> {
  return windows.map((w) => {
    const start = w.day * DAY_MIN + toMin(w.open)
    const closeMin = toMin(w.close)
    const end = w.day * DAY_MIN + (closeMin <= toMin(w.open) ? closeMin + DAY_MIN : closeMin)
    return [start, end]
  })
}

/** Off (or no schedule) = always within hours. */
export function isWithinBusinessHours(schedule: BusinessHours | null | undefined, now: Date): boolean {
  if (!schedule?.enabled) return true
  const m = crClock(now).minuteOfWeek
  return spans(schedule.windows).some(([s, e]) => (m >= s && m < e) || (m + WEEK_MIN >= s && m + WEEK_MIN < e))
}

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** "8:00 a. m." / "12:30 p. m." (es-CR style). */
export function formatCrTime(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/**
 * Next time a window opens after `now` (CR time): { date, label } with label "hoy a las …", "mañana a las …" or
 * "el lunes a las …". Null when the schedule has no windows.
 */
export function nextOpening(schedule: BusinessHours | null | undefined, now: Date): { date: Date; label: string } | null {
  if (!schedule?.windows.length) return null
  const clock = crClock(now)
  let best: { delta: number; startMin: number; day: number } | null = null
  for (const w of schedule.windows) {
    const start = w.day * DAY_MIN + toMin(w.open)
    let delta = (start - clock.minuteOfWeek + WEEK_MIN) % WEEK_MIN
    if (delta === 0) delta = WEEK_MIN
    if (!best || delta < best.delta) best = { delta, startMin: toMin(w.open), day: w.day }
  }
  if (!best) return null
  const minuteStart = Math.floor(now.getTime() / 60_000) * 60_000
  const date = new Date(minuteStart + best.delta * 60_000)
  const daysAhead = Math.floor((clock.minute + best.delta) / DAY_MIN)
  const at = `a las ${formatCrTime(best.startMin)}`
  const label = daysAhead === 0 ? `hoy ${at}` : daysAhead === 1 ? `mañana ${at}` : `el ${DAY_NAMES[best.day]} ${at}`
  return { date, label }
}

export type AfterHoursState = {
  /** The schedule is on and `now` is outside every window. */
  afterHours: boolean
  /** When the team is back (null = no windows / not after hours). */
  opensAt: Date | null
  /** "mañana a las 8:00 a. m." — used in the customer texts and the prompt line. */
  label: string
  note: string | null
}

export const IN_HOURS: AfterHoursState = { afterHours: false, opensAt: null, label: '', note: null }

/** Fallback when no opening can be computed (simulated night in Probar with no schedule). */
const SOON_LABEL = 'apenas vuelva a estar disponible'

export function afterHoursState(schedule: BusinessHours | null | undefined, now: Date, opts?: { simulate?: boolean }): AfterHoursState {
  const outside = opts?.simulate === true || !isWithinBusinessHours(schedule, now)
  if (!outside) return IN_HOURS
  const next = nextOpening(schedule, now)
  return { afterHours: true, opensAt: next?.date ?? null, label: next?.label ?? SOON_LABEL, note: schedule?.afterHoursNote?.trim() || null }
}

/** "mañana a las 8:00 a. m." already ends a sentence; never "a. m.." */
const sentenceEnd = (label: string) => (label.endsWith('.') ? label : `${label}.`)

/** Code-owned prompt line (per turn, only after hours). */
export function afterHoursPromptLine(state: AfterHoursState): string | null {
  if (!state.afterHours) return null
  return (
    `Fuera de horario: si el cliente pregunta por alguien o algo que requiere al equipo, decí con claridad que te ` +
    `atiende el asistente automático y que el equipo responde ${sentenceEnd(state.label)} Nunca prometas revisar o confirmar ahora. ` +
    `(Esto reemplaza "lo revisás y le confirmás". Precios, productos, envíos y métodos de pago los respondés normal.)`
  )
}

/** Hand-off reasons whose customer text gets the after-hours variant (owner_reply keeps the owner's own text). */
const PAYMENT_REASONS = new Set(['payment'])
const ORDER_REASONS = new Set(['order_ready', 'order_ready_cash'])
const PERSON_REASONS = new Set(['human_request', 'escalate', 'complaint'])

export function afterHoursHandoffKind(reason: string | null | undefined): 'payment' | 'order' | 'person' | null {
  const r = String(reason || '')
  if (PAYMENT_REASONS.has(r)) return 'payment'
  if (ORDER_REASONS.has(r)) return 'order'
  if (PERSON_REASONS.has(r)) return 'person'
  return null
}

/** Customer texts after hours (no "confirmado" / "registrado" claims: they pass the write-claim / confirmation checks). */
export function afterHoursHandoffLine(kind: 'payment' | 'order' | 'person', label: string): string {
  if (kind === 'payment') return `¡Gracias! 🙌 Te atiende el asistente automático a esta hora. El equipo revisa tu pago ${label} y te escribe por aquí 😊`
  if (kind === 'order') return `¡Gracias! Recibí los datos de tu pedido. El equipo lo revisa ${label} y te escribe por aquí 😊`
  return `A esta hora te atiende el asistente automático 🌙 El equipo te escribe ${sentenceEnd(label)} Mientras tanto, ¿te ayudo con algo?`
}

/**
 * After hours, a TRUE hand-off's customer text becomes the after-hours variant (+ the owner's note). An order close
 * keeps its checked reply (the order details) and adds the line; the safe line is replaced. Everything else unchanged.
 */
export function applyAfterHoursText(
  plan: { text: string; handoff: { kind: 'handoff' | 'review'; reason: string } | null },
  state: AfterHoursState,
  safeReviewLine: string,
): string {
  if (!state.afterHours || plan.handoff?.kind !== 'handoff') return plan.text
  const kind = afterHoursHandoffKind(plan.handoff.reason)
  if (!kind) return plan.text
  const line = afterHoursHandoffLine(kind, state.label)
  const keep = kind === 'order' && plan.text.trim() && plan.text.trim() !== safeReviewLine.trim()
  const body = keep ? `${plan.text.trim()}\n\n${line}` : line
  return state.note ? `${body}\n${state.note}` : body
}

/** Team alerts for a hand-off after hours: the dedupe key carries `:night-<opening unix seconds>` (quiet until then). */
export const NIGHT_KEY_RE = /:night-(\d{9,11})$/

export function nightKeySuffix(opensAt: Date | null): string {
  const at = opensAt ? opensAt.getTime() : Date.now() + 8 * 3_600_000
  return `:night-${Math.floor(at / 1000)}`
}

/** The key without the night marker (older readers: ':claim', ':order_ready_cash', reason part). */
export function stripNightSuffix(dedupeKey: string | null | undefined): string {
  return String(dedupeKey || '').replace(NIGHT_KEY_RE, '')
}

/** When a night alert may be announced (null = a normal alert). */
export function quietUntilFromKey(dedupeKey: string | null | undefined): Date | null {
  const m = String(dedupeKey || '').match(NIGHT_KEY_RE)
  return m ? new Date(Number(m[1]) * 1000) : null
}

/** UI starting point when the owner turns the schedule on (they edit it right away): Lun–Sáb 8:00–18:00. */
export function starterBusinessHours(): BusinessHours {
  return {
    enabled: true,
    timezone: BUSINESS_HOURS_TIMEZONE,
    windows: [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '08:00', close: '18:00' })),
    afterHoursNote: null,
  }
}
