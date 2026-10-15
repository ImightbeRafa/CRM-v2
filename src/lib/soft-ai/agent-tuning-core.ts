/**
 * Agentes IA 2.0 · E — "Corregir" (live tuning). Pure helpers, client-safe (no Prisma): the owner says how the agent
 * should have answered and code turns it into (a) one more question/answer example in the agent's own corrections
 * document, (b) a saved reply the agent can use, or (c) a "siempre / nunca" line in the selling rules.
 * Deterministic: no AI call to save. Corrections are DATA in the prompt; the fixed rules still win.
 */
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'

export const TUNE_SAVE_AS = ['example', 'saved_reply', 'rule'] as const
export type TuneSaveAs = (typeof TUNE_SAVE_AS)[number]

export const TUNE_CUSTOMER_MAX = 500
export const TUNE_AGENT_REPLY_MAX = 1500
export const TUNE_CORRECTED_MAX = 1200
export const TUNE_NOTE_MAX = 200
export const TUNE_TITLE_MAX = 60
/** Rules lists keep at most this many lines each (parseSalesRules caps at 10 too). */
export const TUNE_RULES_MAX = 10
/**
 * The corrections document must fit the FAQ prompt budget (KNOWLEDGE_LAYER34_CHAR_BUDGET = 3 000, shared with the
 * channel overlay): a FAQ source over the remaining budget is dropped whole from the prompt, so the document stays
 * well under it and the oldest examples go first.
 */
export const TUNE_EXAMPLES_BODY_MAX = 2_400

export type TuneRefusalCode = 'empty' | 'too_long' | 'confirmation' | 'payment_numbers' | 'unknown_amount'
export type TuneCheck = { ok: true } | { ok: false; code: TuneRefusalCode; error: string; amount?: number }

/** Case / accent / punctuation-insensitive key for "the same question". */
export function normalizeQuestion(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
}

/**
 * Real chats: the customer's message may carry their phone, ID, card or email. It becomes part of a document every
 * customer's prompt sees, so long digit runs and emails are masked before saving.
 */
export function maskCustomerMessage(text: string): string {
  return oneLine(text)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '…')
    .replace(/(?<!\d)\d(?:[\s.-]?\d){5,}(?!\d)/g, '…')
    .slice(0, TUNE_CUSTOMER_MAX)
}

function oneLine(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim()
}

/** Reply text keeps its line breaks but never a blank line or a line that could pose as a new "P:" / "R:" entry. */
function answerBlock(text: string): string {
  return (text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (/^(P|R|Nota)\s*:/i.test(line) ? `- ${line}` : line))
    .join('\n')
}

export type CorrectionPair = { question: string; answer: string }

/** Pairs are blocks "P: …\nR: …" separated by a blank line (the format this module writes). */
export function parseCorrectionPairs(body: string): CorrectionPair[] {
  const out: CorrectionPair[] = []
  for (const block of (body || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const m = block.trim().match(/^P:\s*([^\n]*)\nR:\s*([\s\S]*)$/)
    if (m && m[1].trim() && m[2].trim()) out.push({ question: m[1].trim(), answer: m[2].trim() })
  }
  return out
}

export function formatCorrectionPairs(pairs: CorrectionPair[]): string {
  return pairs.map((p) => `P: ${p.question}\nR: ${p.answer}`).join('\n\n')
}

/** One example: the corrected answer, plus the owner's short note when given. */
export function correctionAnswer(correctedReply: string, note?: string | null): string {
  const answer = answerBlock(correctedReply)
  const n = oneLine(note || '')
  return n ? `${answer}\n(Nota del negocio: ${n})` : answer
}

/**
 * Add (or replace) the example for this question, newest last; drop the oldest until the document fits `max`.
 * The new example itself is always kept (callers bound its size).
 */
export function upsertCorrectionPair(body: string, pair: CorrectionPair, max = TUNE_EXAMPLES_BODY_MAX): string {
  const key = normalizeQuestion(pair.question)
  const next: CorrectionPair = { question: oneLine(pair.question), answer: answerBlock(pair.answer) }
  const pairs = parseCorrectionPairs(body).filter((p) => normalizeQuestion(p.question) !== key)
  pairs.push(next)
  while (pairs.length > 1 && formatCorrectionPairs(pairs).length > max) pairs.shift()
  return formatCorrectionPairs(pairs)
}

/** Where a note goes: "nunca …", "no …", "jamás …", "evitá …" → neverSay; anything else ("siempre …") → mustSay. */
export function ruleTarget(note: string): 'neverSay' | 'mustSay' {
  return /^\s*(nunca|jam[aá]s|no|evit[aáe]\w*)(?![\p{L}\p{N}_])/iu.test(note || '') ? 'neverSay' : 'mustSay'
}

/** The prompt already says "Siempre:" / "Nunca:", so the leading word goes ("nunca prometas X" → "prometas X"). */
export function ruleText(note: string): string {
  const t = oneLine(note).replace(/^(siempre|nunca|jam[aá]s|no)(?![\p{L}\p{N}_])[\s,:]*/iu, '').trim()
  return t ? t.slice(0, TUNE_NOTE_MAX) : ''
}

/** Add a rule line (no duplicates), newest last, at most TUNE_RULES_MAX per list (oldest dropped). */
export function placeRule(
  rules: { mustSay: string[]; neverSay: string[] },
  note: string,
): { mustSay: string[]; neverSay: string[]; target: 'neverSay' | 'mustSay'; text: string } {
  const target = ruleTarget(note)
  const text = ruleText(note)
  const lists = { mustSay: [...rules.mustSay], neverSay: [...rules.neverSay] }
  if (text) {
    const key = normalizeQuestion(text)
    const list = lists[target].filter((x) => normalizeQuestion(x) !== key)
    list.push(text)
    lists[target] = list.slice(-TUNE_RULES_MAX)
  }
  return { ...lists, target, text }
}

/** Payment data never goes in a correction: only [[DATOS_PAGO]] (Betsy fills the numbers). */
export function hasPaymentNumbers(text: string): boolean {
  const t = text || ''
  if (/\bCR\s?\d{2}(?:[\s-]?\d{4}){4}[\s-]?\d{2}\b/i.test(t)) return true
  for (const m of t.matchAll(/(?<!\d)\d(?:[\s.-]?\d){7,}(?!\d)/g)) {
    // A big colón amount ("₡12.500.000") is an amount, not an account.
    if (/₡\s?$/.test(t.slice(0, m.index ?? 0))) continue
    return true
  }
  return false
}

/** Colón amounts written in the text ("₡14.900", "₡ 5000", "14 900 colones"). */
export function colonAmountsIn(text: string): number[] {
  const out: number[] = []
  const re = /₡\s?(\d{1,3}(?:[.,  ]\d{3})+|\d+)|(?<![\d.,])(\d{1,3}(?:[.,  ]\d{3})+|\d+)\s*colones/giu
  for (const m of (text || '').matchAll(re)) {
    const n = Number((m[1] || m[2] || '').replace(/\D/g, ''))
    if (Number.isFinite(n) && n > 0) out.push(n)
  }
  return out
}

const fmt = (n: number) => `₡${n.toLocaleString('es-CR')}`

/** Refusals in plain Spanish (shown as-is in the panel). `allowedAmounts` = the agent's own prices. */
export function checkCorrectionText(text: string, allowedAmounts: number[], field = 'La respuesta'): TuneCheck {
  if (hasConfirmationWording(text)) {
    return {
      ok: false,
      code: 'confirmation',
      error: `${field} dice que un pago o pedido está confirmado. El agente nunca confirma pagos ni pedidos: eso lo hace una persona. Escribilo sin esa frase.`,
    }
  }
  if (hasPaymentNumbers(text)) {
    return {
      ok: false,
      code: 'payment_numbers',
      error: `${field} tiene un número de cuenta, SINPE o teléfono (8 dígitos o más). Los datos de pago los pone Betsy: escribí [[DATOS_PAGO]] donde van.`,
    }
  }
  const allowed = new Set(allowedAmounts.map((n) => Math.round(n)))
  const unknown = colonAmountsIn(text).find((n) => !allowed.has(n))
  if (unknown !== undefined) {
    return {
      ok: false,
      code: 'unknown_amount',
      amount: unknown,
      error: `${field} dice ${fmt(unknown)}, y ese monto no es un precio de este agente (productos, envíos o combos). Corregí el monto o actualizá los precios primero.`,
    }
  }
  return { ok: true }
}

/** Shortcut key for a saved reply: fix_<slug>, unique among `taken` (validateShortcutForSave: ^[a-z0-9_]{2,40}$). */
export function savedReplyKey(customerMessage: string, taken: Set<string>): string {
  const slug = normalizeQuestion(customerMessage).replace(/ñ/g, 'n').split(' ').filter(Boolean).slice(0, 5).join('_').slice(0, 30).replace(/_+$/, '')
  const base = `fix_${slug || 'respuesta'}`
  if (!taken.has(base)) return base
  for (let i = 2; i < 1000; i += 1) {
    const k = `${base.slice(0, 36)}_${i}`
    if (!taken.has(k)) return k
  }
  return `fix_${Date.now().toString(36)}`.slice(0, 40)
}

/** Title for a saved reply: the owner's, else the first words of the customer's question. */
export function savedReplyTitle(title: string | null | undefined, customerMessage: string): string {
  const own = oneLine(title || '')
  if (own) return own.slice(0, TUNE_TITLE_MAX)
  const words = oneLine(customerMessage).split(' ').slice(0, 8).join(' ')
  const t = words.length > TUNE_TITLE_MAX - 1 ? `${words.slice(0, TUNE_TITLE_MAX - 1).trim()}…` : words
  return t || 'Respuesta corregida'
}

export type TuneBody = {
  customerMessage: string
  agentReply: string | null
  correctedReply: string
  note: string | null
  saveAs: TuneSaveAs
  title: string | null
}

/** Shape + size checks of the POST body (Spanish errors). */
export function parseTuneBody(raw: unknown): { ok: true; value: TuneBody } | { ok: false; error: string } {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  if (!r) return { ok: false, error: 'Faltan los datos de la corrección.' }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const customerMessage = str(r.customerMessage)
  const agentReply = str(r.agentReply)
  const correctedReply = str(r.correctedReply)
  const note = str(r.note)
  const title = str(r.title)
  const saveAs = r.saveAs === undefined || r.saveAs === null || r.saveAs === '' ? 'example' : r.saveAs
  if (!(TUNE_SAVE_AS as readonly unknown[]).includes(saveAs)) return { ok: false, error: 'Elegí cómo guardar la corrección.' }
  if (!customerMessage) return { ok: false, error: 'Falta el mensaje del cliente.' }
  if (customerMessage.length > TUNE_CUSTOMER_MAX) return { ok: false, error: `El mensaje del cliente supera ${TUNE_CUSTOMER_MAX} caracteres.` }
  if (agentReply.length > TUNE_AGENT_REPLY_MAX) return { ok: false, error: `La respuesta del agente supera ${TUNE_AGENT_REPLY_MAX} caracteres.` }
  if (note.length > TUNE_NOTE_MAX) return { ok: false, error: `La nota supera ${TUNE_NOTE_MAX} caracteres.` }
  if (title.length > TUNE_TITLE_MAX) return { ok: false, error: `El título supera ${TUNE_TITLE_MAX} caracteres.` }
  if (correctedReply.length > TUNE_CORRECTED_MAX) return { ok: false, error: `La respuesta corregida supera ${TUNE_CORRECTED_MAX} caracteres.` }
  if (saveAs === 'rule') {
    if (!note) return { ok: false, error: 'Para guardar una regla, escribila en "Nota" (por ejemplo: "nunca prometas bajar de peso").' }
  } else if (!correctedReply) {
    return { ok: false, error: 'Escribí cómo debería responder.' }
  }
  return {
    ok: true,
    value: { customerMessage, agentReply: agentReply || null, correctedReply, note: note || null, saveAs: saveAs as TuneSaveAs, title: title || null },
  }
}
