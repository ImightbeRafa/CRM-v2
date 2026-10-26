/**
 * agents2-hours (Rafael 2026-10-16): "Horario de atención" per agent line. Default OFF = 24/7 (no behaviour change).
 * Costa Rica time (America/Costa_Rica = UTC-6 all year, no daylight saving). Weekly windows; a window whose close is
 * at or before its open runs past midnight ("20:00–02:00"). Pure and client-safe (live turn, Probar, settings UI).
 *
 * After hours the agent still sells and answers; code adds a prompt line and swaps the customer text of a TRUE
 * hand-off for an after-hours variant (the team answers at the next opening); team alerts are created but quiet.
 * A model escalation / "no lo tengo" at night is NOT a hand-off: see nightKeepsSelling.
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
  // Verifier F6: a schedule that is on must open at least once a week (otherwise it is "always closed").
  .refine((h) => !h.enabled || h.windows.length > 0, { message: 'enabled_without_windows' })

/**
 * Verifier F5: the after-hours note goes to the customer as-is (code text, no token filling): no [[…]] / [ … ]
 * markers, {{…}} templates or < > tags.
 */
export const NOTE_MARKER_RE = /[[\]{}<>【】]/
export function afterHoursNoteHasMarker(note: string | null | undefined): boolean {
  return NOTE_MARKER_RE.test(String(note || ''))
}

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
  /**
   * Verifier F7: the agent's "¿Sos un bot?" setting is 'transparent' — only then do the texts / prompt line say
   * "asistente virtual". Discreet = neutral wording ("el equipo no está disponible"), never claims to be a person.
   */
  transparent: boolean
}

export const IN_HOURS: AfterHoursState = { afterHours: false, opensAt: null, label: '', note: null, transparent: false }

/** Fallback when no opening can be computed (simulated night in Probar with no schedule). */
const SOON_LABEL = 'apenas vuelva a estar disponible'

export function afterHoursState(
  schedule: BusinessHours | null | undefined,
  now: Date,
  opts?: { simulate?: boolean; aiDisclosure?: 'transparent' | 'discreet' | null },
): AfterHoursState {
  const outside = opts?.simulate === true || !isWithinBusinessHours(schedule, now)
  if (!outside) return IN_HOURS
  const next = nextOpening(schedule, now)
  const note = schedule?.afterHoursNote?.trim() || null
  return {
    afterHours: true,
    opensAt: next?.date ?? null,
    label: next?.label ?? SOON_LABEL,
    note: note && !afterHoursNoteHasMarker(note) ? note : null,
    transparent: opts?.aiDisclosure === 'transparent',
  }
}

/** "mañana a las 8:00 a. m." already ends a sentence; never "a. m.." */
const sentenceEnd = (label: string) => (label.endsWith('.') ? label : `${label}.`)

/** Code-owned prompt line (per turn, only after hours). */
export function afterHoursPromptLine(state: AfterHoursState): string | null {
  if (!state.afterHours) return null
  const who = state.transparent
    ? 'que te atiende nuestro asistente virtual y que el equipo responde'
    : 'que a esta hora el equipo no está disponible y que responde'
  return (
    // Rafael 2026-10-25: at night the agent sells exactly like by day; only payments and a person wait for the team.
    `Fuera de horario: seguís atendiendo y vendiendo igual que de día (precios, productos, tallas, uso, envíos, ` +
    `métodos de pago y cerrar el pedido). Solo confirmar un pago o comprobante, un reclamo o lo que de verdad solo ` +
    `puede hacer una persona espera al equipo: ahí decí con claridad ${who} ${sentenceEnd(state.label)} ` +
    `Nunca prometas revisar o confirmar ahora. (Esto reemplaza "lo revisás y le confirmás".)` +
    (state.transparent
      ? ' Si todavía no te presentaste en este chat, presentate con tu nombre como asistente virtual del negocio (por ejemplo: "¡Hola! Soy <tu nombre>, asistente virtual de <negocio> 🌙").'
      : '')
  )
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * luna-10 (Rafael 2026-10-17): at night a transparent agent ALWAYS introduces itself as the virtual assistant —
 * code-owned (the model followed the prompt line in 2 of 4 night replies). Verifier round 2: never cut or replace what
 * the agent wrote — when it introduced itself ("Soy Sofi de PatchHouse CR", "Hola 👋 soy Sofi y sí tenemos envíos"),
 * ", asistente virtual" is INSERTED right after the name; with no self-introduction, the intro goes first only when
 * nobody has written to the customer yet in this chat. Day, discreet, no name, or already says "asistente virtual":
 * unchanged.
 */
export function withNightIntro(
  text: string,
  state: Pick<AfterHoursState, 'afterHours' | 'transparent'>,
  who: { name: string | null | undefined; store: string | null | undefined; introduced: boolean },
): string {
  const name = (who.name || '').trim()
  if (!state.afterHours || !state.transparent || !name) return text
  const t = (text || '').trim()
  if (!t || /asistente virtual/iu.test(t)) return text
  // The first self-introduction in the first line (Unicode word edges: "\b" is ASCII-only — José / Ángela).
  // The first two non-empty lines ("¡Hola! 👋\nSoy Sofi de…").
  const lines = t.split('\n')
  let scanEnd = 0
  for (let i = 0, seen = 0; i < lines.length && seen < 2; i++) {
    scanEnd += lines[i].length + 1
    if (lines[i].trim()) seen += 1
  }
  const self = new RegExp(`(?<![\\p{L}\\p{N}])(?:soy|te\\s+escribe|te\\s+habla|habla)\\s+${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'iu').exec(t.slice(0, scanEnd))
  if (self) {
    const at = self.index + self[0].length
    const rest = t.slice(at)
    // " de PatchHouse CR" / punctuation / emoji / end → ", asistente virtual" + rest; " y sí tenemos…" → a comma closes it.
    const joiner = /^(\s+de\s|[ \t]*(\n|$)|[,.;:!?)]|\s*[\p{Extended_Pictographic}])/u.test(rest) ? ', asistente virtual' : ', asistente virtual,'
    return `${t.slice(0, at)}${joiner}${rest}`
  }
  if (who.introduced) return text
  const store = (who.store || '').trim()
  return `¡Hola! Soy ${name}, asistente virtual${store ? ` de ${store}` : ''} 🌙\n\n${t}`
}

/** Hand-off reasons whose customer text gets the after-hours variant (owner_reply keeps the owner's own text). */
const PAYMENT_REASONS = new Set(['payment'])
const ORDER_REASONS = new Set(['order_ready', 'order_ready_cash'])
const PERSON_REASONS = new Set(['human_request', 'escalate', 'complaint', 'unknown_answer'])

export function afterHoursHandoffKind(reason: string | null | undefined): 'payment' | 'order' | 'person' | null {
  const r = String(reason || '')
  if (PAYMENT_REASONS.has(r)) return 'payment'
  if (ORDER_REASONS.has(r)) return 'order'
  if (PERSON_REASONS.has(r)) return 'person'
  return null
}

/** Customer texts after hours (no "confirmado" / "registrado" claims: they pass the write-claim / confirmation checks). */
export function afterHoursHandoffLine(kind: 'payment' | 'order' | 'person', label: string, transparent = false): string {
  if (kind === 'order') return `¡Gracias! Recibí los datos de tu pedido. El equipo lo revisa ${label} y te escribe por aquí 😊`
  if (kind === 'payment') {
    return transparent
      ? `¡Gracias! 🙌 Te atiende nuestro asistente virtual a esta hora. El equipo revisa tu pago ${label} y te escribe por aquí 😊`
      : `¡Gracias! 🙌 A esta hora el equipo no está disponible. Revisan tu pago ${label} y te escriben por aquí 😊`
  }
  // Verifier F4: the chat goes to a person (opt-out included) — never "¿te ayudo con algo?" from the bot.
  return transparent
    ? `A esta hora te atiende nuestro asistente virtual 🌙 El equipo te escribe ${label} 😊`
    : `A esta hora el equipo no está disponible; te escriben ${label} 😊`
}

/** After-hours replacement for the in-hours safe line ("Dame un momento y te confirmo"): same prefix for both wordings. */
export const AFTER_HOURS_REVIEW_PREFIX = 'Gracias por escribir 😊 A esta hora'

export function afterHoursReviewLine(label: string, transparent = false): string {
  return transparent
    ? `${AFTER_HOURS_REVIEW_PREFIX} te atiende nuestro asistente virtual; el equipo te escribe ${sentenceEnd(label)}`
    : `${AFTER_HOURS_REVIEW_PREFIX} el equipo no está disponible; te escriben ${sentenceEnd(label)}`
}

/** "Enseguida te paso cómo pagar" promises immediacy: after hours the team sends it at the next opening. */
export function afterHoursPaymentSoonLine(label: string): string {
  return `El equipo te pasa cómo pagar ${label} 😊`
}

/** INT-121: added after the owner's opt-out text ("en un momento te escribe alguien") — keeps their words. */
export function afterHoursTeamLine(label: string): string {
  return `El equipo te escribe ${sentenceEnd(label)}`
}

/**
 * Lane C D3 (2026-10-22): a complaint, a late order or a refund gets an empathetic hand-off line — never "¡Gracias!".
 * In the agent's voice (fixed rule 10: no "te paso con otra persona").
 */
export const COMPLAINT_HANDOFF_LINE = 'Lamento mucho lo que pasó 🙏 Ya lo estoy revisando y te escribo en cuanto tenga noticias.'

export function afterHoursComplaintLine(label: string, transparent = false): string {
  return `Lamento mucho lo que pasó 🙏 ${afterHoursHandoffLine('person', label, transparent)}`
}

/**
 * Lane C P8: a sentence that promises a person answers right now ("en un momento te escribe alguien") — false after
 * hours. Both an immediacy word and a reply verb (Verifier #128-3: "Ahorita tenemos el kit en ₡14 900" is a fact).
 */
const IMMEDIATE_WORD_RE =
  /(?<![\p{L}])(?:en\s+un\s+(?:momento|momentito|ratito|toque)|enseguida|en\s+seguida|ahorita|ahora\s+mismo|en\s+breve|ya\s+mismo|de\s+inmediato|inmediatamente)(?![\p{L}])/iu
const REPLY_VERB_RE =
  /(?<![\p{L}])(?:te|le|les|lo|la)\s+(?:escrib\p{L}*|atiend\p{L}*|atender\p{L}*|contest\p{L}*|respond\p{L}*|ayud\p{L}*|llam\p{L}*|habl\p{L}*)|(?<![\p{L}])alguien(?![\p{L}])|(?<![\p{L}])(?:te|le)\s+paso\s+con|(?<![\p{L}])(?:te|le|les|lo|la)\s+(?:contact\p{L}*|confirm\p{L}*|avis\p{L}*)/iu

/**
 * Lane C P8, fail safe (Verifier #130): a text that promises a person answers right now (an immediacy word AND a reply
 * verb, anywhere in it) is never cut into pieces at night — it is replaced whole by the night person line. Cutting
 * sentences broke "a. m.", "Dra.", prices and phones; a whole-text swap cannot garble anything.
 */
export function hasImmediatePromise(text: string): boolean {
  return IMMEDIATE_WORD_RE.test(text) && REPLY_VERB_RE.test(text)
}

/** SecureDog #130 L1: an owner text with a safety / fraud notice is never replaced (the notice matters more). */
const SAFETY_NOTICE_RE =
  /(?<![\p{L}])(?:pin|contrase[nñ]a|clave|c[oó]digo|cvv|tarjeta|estafa\p{L}*|fraude|falso|falsa|nunca\s+te\s+(?:pedimos|pediremos|vamos\s+a\s+pedir)|suspend\p{L}*|m[eé]dico|emergenci\p{L}*|urgen\p{L}*|911)(?![\p{L}])/iu
/** Verifier #130 r2: contact info or a price (a phone, an e-mail, a link, ₡ / $) — never lost by the night swap. */
const CONTACT_OR_PRICE_RE = /@|https?:\/\/|www\.|\d[\d\s.-]{6,}\d|[₡¢$]\s?\d/u
export function hasSafetyNotice(text: string): boolean {
  return SAFETY_NOTICE_RE.test(text) || CONTACT_OR_PRICE_RE.test(text)
}

export type AfterHoursTextOptions = {
  /** SAFE_LINE.review ("Dame un momento y te confirmo 😊"). */
  safeReview: string
  /** SAFE_LINE.paymentSoon ("Enseguida te paso cómo pagar 😊"). */
  paymentSoon?: string
  /** F5 / INT-120: the owner's note must pass this check at send time too; false = the note is dropped. */
  noteOk?: (note: string) => boolean
  /** F5: leftover check on the composed text; false = drop the note. */
  composedOk?: (text: string) => boolean
}

/**
 * After hours (pure):
 * - a TRUE hand-off's customer text becomes the after-hours variant (+ the owner's note). An order close keeps its
 *   checked reply and adds the line; an opt-out keeps the owner's text and adds "El equipo te escribe <label>";
 *   payment / escalate / complaint get the code text; owner_reply is unchanged;
 * - the in-hours safe lines that promise immediacy (safe line, "Enseguida te paso cómo pagar") get the after-hours
 *   wording. Everything else (normal answers) is unchanged.
 */
export function applyAfterHoursText(
  plan: { text: string; handoff: { kind: 'handoff' | 'review'; reason: string } | null },
  state: AfterHoursState,
  opts: AfterHoursTextOptions,
): string {
  if (!state.afterHours) return plan.text
  const text = plan.text.trim()
  let body: string | null = null
  if (plan.handoff?.kind === 'handoff') {
    const kind = afterHoursHandoffKind(plan.handoff.reason)
    if (!kind) return plan.text
    // A "no lo tengo" answer (unknown_answer) keeps what the agent did know, then says when the team writes.
    // Lane C D3: the empathetic complaint line keeps its empathy at night ("Lamento mucho… te escriben mañana").
    const complaint = text === COMPLAINT_HANDOFF_LINE
    // Lane C P8: "en un momento te escribe alguien" + "El equipo te escribe mañana" contradicted each other: the
    // sentences that promise right now are dropped at night (the owner's other words are kept).
    // Lane C P8 / Verifier #130: an opt-out text that promises an answer right now is replaced whole by the night line
    // (an unknown_answer reply keeps every fact: it never promises a person right now).
    const promise = plan.handoff.reason === 'human_request' && hasImmediatePromise(text) && !hasSafetyNotice(text)
    if (complaint) {
      body = afterHoursComplaintLine(state.label, state.transparent)
    } else if (kind === 'person' && !promise && (plan.handoff.reason === 'human_request' || plan.handoff.reason === 'unknown_answer') && text && text !== opts.safeReview.trim()) {
      // luna-10: the model already said when the team writes ("…hoy a las 8:00 a. m.") → never a second line.
      body = text.includes(state.label.replace(/\.$/, '')) ? text : `${text}\n${afterHoursTeamLine(state.label)}`
    } else {
      const line = afterHoursHandoffLine(kind, state.label, state.transparent)
      const keep = kind === 'order' && text && text !== opts.safeReview.trim()
      body = keep ? `${text}\n\n${line}` : line
    }
  } else if (text === opts.safeReview.trim()) {
    body = afterHoursReviewLine(state.label, state.transparent)
  } else if (opts.paymentSoon && text.endsWith(opts.paymentSoon.trim())) {
    const before = text.slice(0, text.length - opts.paymentSoon.trim().length).trim()
    body = before ? `${before}\n${afterHoursPaymentSoonLine(state.label)}` : afterHoursPaymentSoonLine(state.label)
  }
  if (body === null) return plan.text
  // The owner's note only rides on a hand-off text.
  if (plan.handoff?.kind !== 'handoff' || !state.note || afterHoursNoteHasMarker(state.note)) return body
  if (opts.noteOk && !opts.noteOk(state.note)) return body
  const withNote = `${body}\n${state.note}`
  return !opts.composedOk || opts.composedOk(withNote) ? withNote : body
}

/**
 * Rafael 2026-10-25: after hours the agent sells exactly like by day. Only payments / receipts, a refund or complaint,
 * an order to confirm and a customer who asks for a person wait for the team. A model escalation ("other": a store fact
 * it does not have, a health question…) or a "no lo tengo" answer at night used to replace the whole reply with "El
 * equipo te escribe mañana" AND move the chat to a person — nobody is there at night, so the customer got no answer
 * and every later message waited for the morning. At night those two become a review: the agent's own answer goes out
 * (with its images), the chat stays on the agent, and the team gets the alert (quiet until opening).
 * 'escalate' is the model's catch-all (a complaint, a health alarm and "pasame con la dueña" arrive as it too), so the
 * customer's own words decide: a complaint, an alarm or a person request keeps the true hand-off (Verifier #1).
 */
const NIGHT_REVIEW_REASONS = new Set(['escalate', 'unknown_answer'])
/** escalate_to_human reasons the model gives for a complaint / an alarm / a person: never downgraded at night. */
const NIGHT_PERSON_MODEL_REASONS = new Set(['complaint', 'safety', 'opt_out', 'ownership', 'payment_or_sinpe', 'payment_claim', 'media_inbound'])

/**
 * Backstop for the model's reason: the customer's words show a complaint (damaged / wrong / late / not working), a
 * health alarm or crisis, or ask for a person. Pre-sale questions ("¿tienen devolución?", "¿me puede dar alergia?",
 * "soy dueña de una tienda") are NOT matched: a symptom counts only as something that happened ("me salió una roncha").
 */
const NIGHT_PERSON_RE = new RegExp(
  [
    // Complaint about an order / the product.
    String.raw`(?:vino|vinieron|lleg[oó]|llegaron|est[aá]|viene)\s+(?:\p{L}+\s+)?(?:rot[oa]s?|da[ñn]ad[oa]s?|mal|incomplet[oa]s?|abiert[oa]s?|equivocad[oa]s?|defectuos[oa]s?)`,
    String.raw`me\s+(?:lleg[oó]|mandaron|enviaron)\s+otr[oa]`,
    String.raw`no\s+(?:me\s+)?(?:funciona|funcion[oó]|sirve|sirvi[oó])`,
    String.raw`p[eé]sim\p{L}*|(?:qu[eé]\s+)?mal\s+servicio|muy\s+molest[oa]|me\s+estafaron|estafador\p{L}*|quiero\s+(?:poner\s+)?(?:una\s+)?(?:queja|reclamo)`,
    String.raw`quiero\s+(?:devolver|(?:la|una|mi)\s+devoluci[oó]n|(?:un|mi)\s+reembolso|que\s+me\s+devuelvan)|devu[eé]lvanme`,
    String.raw`(?:todav[ií]a|a[uú]n)\s+no\s+(?:me\s+)?lleg\p{L}*`,
    // Health alarm (something that happened).
    String.raw`(?:me|le|nos)\s+(?:dio|sali[oó]|salieron|caus[oó]|provoc[oó]|est[aá]\s+dando)\s+(?:\p{L}+\s+){0,3}(?:reacci\p{L}*|alergi\p{L}*|irritaci\p{L}*|ronchas?|picaz\p{L}*|sarpullido|ampollas?|ardor|comez\p{L}*|mareo)`,
    String.raw`(?:se\s+me|se\s+le)\s+hinch\p{L}*|me\s+arde|me\s+quem[eó]|quemadura|v[oó]mit\p{L}*|vomit\p{L}*|estoy\s+mare\p{L}*|me\s+siento\s+(?:muy\s+)?mal`,
    String.raw`dolor\s+(?:de|en\s+el)\s+pecho|palpitaciones|falta\s+de\s+aire|no\s+puedo\s+respirar|desmay\p{L}*|convulsi\p{L}*`,
    String.raw`se\s+(?:puso|comi[oó]|trag[oó]|meti[oó])\s+(?:\p{L}+\s+){0,2}(?:parche|tira|producto|pastilla)|me\s+trag[eé]`,
    // Crisis.
    String.raw`me\s+quiero\s+morir|quiero\s+morir(?:me)?|quitarme\s+la\s+vida|no\s+quiero\s+vivir|hacerme\s+da[ñn]o|cortarme|autolesi\p{L}*|suicid\p{L}*|matarme`,
    // A person.
    String.raw`p[aá]s(?:a|e)me\s+con|comun[ií]c(?:a|e)me\s+con|hablar\s+con\s+(?:una\s+persona|alguien|un\s+humano|un\s+asesor|una\s+asesora|el\s+due[ñn]o|la\s+due[ñn]a|el\s+encargad[oa]|la\s+encargad[oa]|el\s+gerente|un\s+supervisor)`,
    String.raw`(?:me\s+)?(?:puede|pueden|podr[ií]a|podr[ií]an)\s+llamar|ll[aá]menme|ll[aá]mame`,
  ].map((p) => `(?:${p})`).join('|'),
  'iu',
)
const NIGHT_PERSON_WORDS_RE = new RegExp(`(?<![\\p{L}])(?:${NIGHT_PERSON_RE.source})(?![\\p{L}])`, 'iu')

export function customerNeedsPersonAtNight(customerText: string | null | undefined, isComplaint?: (text: string) => boolean): boolean {
  const t = String(customerText || '').normalize('NFKC')
  if (NIGHT_PERSON_WORDS_RE.test(t)) return true
  // The day's complaint check also reads pre-sale questions as one ("¿Tienen devolución?", "¿no es estafa?"): at night
  // it counts only when the customer is not just asking a question.
  const onlyQuestions = t.split(/\n+/).every((line) => !line.trim() || /\?\s*\p{Extended_Pictographic}*\s*$/u.test(line.trim()))
  return !onlyQuestions && isComplaint?.(t) === true
}

/**
 * The reply promises a check the team does at the next opening (first person only: "lo confirmo", "voy a revisar",
 * "déjeme consultar", "te aviso apenas…"). Never the customer's voseo ("lo consultás con tu médico") or a plain fact
 * ("Te cuento que sí tenemos envíos").
 */
const CHECK_PROMISE_RE =
  /(?<![\p{L}])(?:(?:confirm|revis|consult|verific|averigu|cheque|pregunt)(?:o|amos)(?![\p{L}])(?!\s+(?:que|cada)(?![\p{L}]))(?!\s*:)|voy\s+a\s+(?:confirm|revis|consult|verific|averigu|cheque|pregunt)\p{L}*|d[eé]j(?:ame|eme|enme)\s+(?:confirm|revis|consult|verific|averigu|cheque|pregunt)\p{L}*|permit(?:ime|ame|eme)\s+(?:confirm|revis|consult|verific|averigu|cheque|pregunt)\p{L}*|(?:te|le)\s+(?:cuento|aviso|escribo|confirmo)\s+(?:apenas|cuando|en\s+cuanto)|dame\s+un\s+(?:momento|momentito|segundo)|un\s+momentito)(?![\p{L}])/iu

export function hasCheckPromise(text: string): boolean {
  return CHECK_PROMISE_RE.test(text)
}

type NightPlan = { text: string; handoff: { kind: 'handoff' | 'review'; reason: string } | null }

/** Sentence pieces (never inside "a. m." / "₡14.900": a split needs "!", "?", "…" or a 2-letter word + "."). */
const SENTENCE_SPLIT_RE = /(?<=[!?…]|[^\s.]{2}\.)\s+(?=[¡¿\p{Lu}\p{Extended_Pictographic}])|\n+/u
/** A team check promised for right now ("Enseguida te confirmo", "Dame un momento y lo reviso", "ahorita alguien te escribe"). */
const NOW_CHECK_RE = /(?<![\p{L}])(?:alguien|te\s+paso\s+con|(?:te|le)\s+(?:escrib|contact|llam)\p{L}*)(?![\p{L}])/iu
function isNowCheckSentence(s: string): boolean {
  if (/^\s*dame\s+un\s+(?:momento|momentito|segundo)/iu.test(s)) return true
  // The immediacy word + a check / a person in the SAME sentence ("Ahorita tenemos el kit en ₡14 900" is a fact).
  return hasImmediatePromise(s) && (hasCheckPromise(s) || NOW_CHECK_RE.test(s))
}

/**
 * Run BEFORE applySafeLineCap (the safe line's loop cap keeps working). Returns the plan to send, the review to settle
 * apart from it when the agent's own answer goes out (so the answer keeps its images), and `soft` = the night turned a
 * hand-off into a review (the chat stays on the agent).
 */
export function nightKeepsSelling<P extends NightPlan>(
  plan: P,
  state: Pick<AfterHoursState, 'afterHours' | 'label'>,
  opts: {
    safeReview: string
    customerText?: string | null
    /** Raw escalate_to_human reason the model gave ("complaint" / "safety" … never downgraded). */
    modelReason?: string | null
    cannotAnswer?: (text: string) => boolean
    isComplaint?: (text: string) => boolean
  },
): { plan: P; review: { kind: 'review'; reason: string } | null; soft: boolean } {
  const h = plan.handoff
  const unchanged = { plan, review: null, soft: false }
  if (!state.afterHours || h?.kind !== 'handoff' || !NIGHT_REVIEW_REASONS.has(h.reason)) return unchanged
  if (opts.modelReason && NIGHT_PERSON_MODEL_REASONS.has(opts.modelReason)) return unchanged
  if (customerNeedsPersonAtNight(opts.customerText, opts.isComplaint)) return unchanged
  const review = { kind: 'review' as const, reason: h.reason }
  const text = plan.text.trim()
  // Verifier r2 #2: only the sentences that promise a team check RIGHT NOW are dropped — prices, the size guide and
  // "Te dejo…" stay. Nothing left (or the safe line): the after-hours review line, the chat stays on the agent.
  const pieces = text.split(SENTENCE_SPLIT_RE).map((p) => p.trim()).filter(Boolean)
  const kept = pieces.filter((p) => hasSafetyNotice(p) || !isNowCheckSentence(p))
  const dropped = kept.length < pieces.length
  const body = kept.join(' ')
  if (!body || text === opts.safeReview.trim()) return { plan: { ...plan, text: opts.safeReview, handoff: review }, review: null, soft: true }
  const kept1 = dropped ? body : text
  const promises = dropped || h.reason === 'unknown_answer' || hasCheckPromise(kept1) || opts.cannotAnswer?.(kept1) === true
  const saysWhen = kept1.includes(state.label.replace(/\.$/, ''))
  return { plan: { ...plan, handoff: null, text: promises && !saysWhen ? `${kept1}\n${afterHoursTeamLine(state.label)}` : kept1 }, review, soft: true }
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
