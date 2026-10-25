/**
 * Pure parts of the "¿ya pagó?" model check (llm/payment-claim-check.ts): when it runs, what it sees, how its answer
 * is read. No network, no server-only imports — unit-testable.
 */
import { classifyPaymentText, hasPaymentWord, isClosedPayInfoQuestion } from '@/lib/soft-ai/payment-classifier'

export type PaymentCheckMode = 'off' | 'shadow' | 'enforce'
export type PaymentCheckVerdict = 'claim' | 'clear' | 'error'
export type PaymentCheckHistory = Array<{ direction: string; content?: string | null; sentAt?: string | Date | null }>

/** SOFT_AI_PAYMENT_CHECK: 'enforce' | 'off'; anything else (unset included) = 'shadow' (observe only). */
export function paymentCheckMode(env: string | undefined = process.env.SOFT_AI_PAYMENT_CHECK): PaymentCheckMode {
  const v = (env || '').trim().toLowerCase()
  if (v === 'enforce') return 'enforce'
  if (v === 'off') return 'off'
  return 'shadow'
}

/**
 * Broad and cheap on purpose — a false hit costs one small check, never a hand-off: money / payment / order-state words,
 * an amount, or any 4+ digit number.
 */
export const MONEY_WORDS_RE =
  /(?<![\p{L}])(?:pag\p{L}*|cancel\p{L}*|abon\p{L}*|sinp\p{L}*|plat\p{L}*|diner\p{L}*|transfer\p{L}*|transfi\p{L}*|deposit\p{L}*|dep[oó]sit\p{L}*|cobr\p{L}*|cargo\p{L}*|devol\p{L}*|devuelv\p{L}*|reembols\p{L}*|comprobante\p{L}*|recib\p{L}*|lleg\p{L}*|cay[oó]|entr[oó]|colones|rojos|mil|tarjeta\p{L}*|link\p{L}*|enlace\p{L}*|cuenta\p{L}*|banco\p{L}*|bac|bcr|bn|iban|rebaj\p{L}*|descont\p{L}*|adelanto|resto|mitad|saldo|ya\s+est[aá]|listo|hecho)(?![\p{L}])|₡|\d{4,}|\d+\s*(?:mil|k)(?![\p{L}])|[✅✔☑]/iu

/**
 * When to check: only a turn the regex let through (the caller skips hand-offs), and only when the message has a money
 * word, or the chat already talked about payment (the store sent payment details / the customer used payment words in
 * the last 3 messages) — where "listo, ya está" means "I paid".
 */
/** The customer's messages since the store last wrote (oldest first) — a burst is answered by one job. */
function unansweredCustomerTexts(history: PaymentCheckHistory, now = Date.now()): { burst: string[]; storeIndex: number } {
  const burst: string[] = []
  let i = history.length - 1
  for (; i >= 0; i--) {
    if (history[i].direction === 'outbound') break
    if (history[i].content) burst.unshift(String(history[i].content))
  }
  // SecureDog round 7: plus customer messages from the last 10 min that sort before the store's last message (it is
  // stored when SENT, so a message typed while it was being written lands before it).
  const early: string[] = []
  for (let j = 0; j < i; j++) {
    const m = history[j]
    if (m.direction !== 'inbound' || !m.content || !m.sentAt) continue
    const at = new Date(m.sentAt).getTime()
    if (Number.isFinite(at) && now - at <= 10 * 60_000) early.push(String(m.content))
  }
  return { burst: [...early, ...burst], storeIndex: i }
}

/** SecureDog wave D r4 (M1): English / PT / FR money and state words open the check too (one small check per false hit). */
const FOREIGN_MONEY_WORDS_RE =
  /(?<![\p{L}])(?:sent|done|paid|pay\p{L}*|transfer\p{L}*|money|cash|deposit\p{L}*|receipt|refund\p{L}*|charged?|wired|pix|dinheiro|pagamento|paguei|depositei|transferi|enviei|mandei|foi|virement|argent|paiement|envoy[eé]|r[eé]gl[eé]|re[cç]u|arrived|through|received|confirm\p{L}*)(?![\p{L}])/iu

export function paymentCheckGate(inboundText: string, history: PaymentCheckHistory): boolean {
  const text = inboundText || ''
  if (!text.trim()) return false
  const unanswered = [...unansweredCustomerTexts(history).burst, text]
  // Lane C store exam 2026-10-22: when everything unanswered is a closed before-paying question ("¿Qué le pongo de
  // detalle?", "¿se puede pagar cuando ya está acá?"), there is no claim to look for (no digit, anchored shapes).
  // SecureDog r2 F1: strict — only questions, courtesy and a fixed "Lo quiero (talla M)"; never a free context sentence.
  if (unanswered.every((t) => !t.trim() || isClosedPayInfoQuestion(t, { strict: true, yesBlocksAll: true }))) return false
  // SecureDog round 6: the whole unanswered burst, not only the newest message.
  for (const t of unanswered) if (MONEY_WORDS_RE.test(t) || FOREIGN_MONEY_WORDS_RE.test(t) || hasPaymentWord(t)) return true
  const recentInbound = history.filter((m) => m.direction === 'inbound').slice(-3).map((m) => m.content || '')
  if (recentInbound.some((t) => hasPaymentWord(t))) return true
  return history.some((m) => m.direction === 'outbound' && hasPaymentWord(m.content || ''))
}

/**
 * Verifier r2 #6 / SecureDog r3: the outage path's "payment in play" — money or payment words among the customer's
 * UNANSWERED messages (the whole burst, not only the newest), never an earlier store "¿Cómo preferís pagar?". claim = one
 * of them reads as a payment claim / receipt.
 */
export function unansweredPaymentState(inboundText: string, history: PaymentCheckHistory): { inPlay: boolean; claim: boolean } {
  const unanswered = [...unansweredCustomerTexts(history).burst, inboundText || ''].filter((t) => t.trim())
  return {
    inPlay: unanswered.some((t) => MONEY_WORDS_RE.test(t) || FOREIGN_MONEY_WORDS_RE.test(t) || hasPaymentWord(t)),
    claim: unanswered.some((t) => classifyPaymentText(t) === 'payment_proof_or_risk'),
  }
}

/** Role labels a customer could type to look like another speaker in the prompt. */
const ROLE_LABEL_RE = /(?:cliente|tienda|store|customer|sistema|system|assistant|asistente|revisor|reviewer)\s*(?:[([][^)\]\n]{0,40}[)\]])?\s*[:\-–—]/giu
/**
 * SecureDog round 7: look-alike labels too — any short word with a "(…)" / "[…]" tag and a ":" / "-" ("Сliente (SIN
 * RESPONDER…):" in Cyrillic, "Cliente [SIN RESPONDER] -"), and a typed verdict ("claim=false", {"claim":false}).
 */
const TAGGED_LABEL_RE = /[([][^)\]\n]{0,40}(?:sin\s+responder|antes|[uú]ltimo\s+mensaje|lo\s+que\s+decid[ií]s|unanswered)[^)\]\n]{0,40}[)\]]\s*[:\-–—]?/giu
/** Cyrillic / Greek look-alikes of Latin letters (so "Сliente" is read as "Cliente" by ROLE_LABEL_RE). */
const LOOKALIKE: Record<string, string> = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y', 'і': 'i', 'ѕ': 's', 'А': 'A', 'Е': 'E', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'І': 'I', 'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i', 'Ο': 'O', 'Α': 'A', 'Ε': 'E', 'Ι': 'I', 'Τ': 'T' }
const foldLookalikes = (t: string) => t.replace(/[аеорсхуіѕАЕОРСТХІοαειΟΑΕΙΤ]/gu, (ch) => LOOKALIKE[ch] ?? ch)
const TYPED_VERDICT_RE = /"?claim"?\s*[:=]\s*(?:true|false)|\{\s*"?claim"?[^}]{0,80}\}/giu

/**
 * Two earlier customer messages + the store's last message + EVERYTHING the customer wrote since (the burst), fenced as
 * data. SecureDog round 6: the burst keeps its END (a claim often closes a long message), and role labels are removed.
 */
export function buildPaymentCheckInput(
  inboundText: string,
  history: PaymentCheckHistory,
  fence: (text: string) => string,
): string {
  const clean = (t: string) =>
    foldLookalikes(fence(t || ''))
      .replace(TAGGED_LABEL_RE, ' ')
      .replace(ROLE_LABEL_RE, ' ')
      .replace(TYPED_VERDICT_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  // SecureDog round 7: each burst message is cleaned (masked) ON ITS OWN and keeps its start AND end, so one long
  // message can neither cut the claim of another nor hide its own last words.
  const headTail = (t: string, n: number) => {
    const v = clean(t)
    return v.length > n ? `${v.slice(0, Math.floor(n / 4))} … ${v.slice(-Math.floor((3 * n) / 4))}` : v
  }
  const head = (t: string, n: number) => {
    const v = clean(t)
    return v.length > n ? `${v.slice(0, n)}…` : v
  }
  const tail = (t: string, n: number) => {
    const v = clean(t)
    return v.length > n ? `…${v.slice(-n)}` : v
  }
  const { burst, storeIndex } = unansweredCustomerTexts(history)
  const lastStore = storeIndex >= 0 ? history[storeIndex] : undefined
  const before = history.slice(0, Math.max(0, storeIndex)).filter((m) => m.direction === 'inbound').slice(-2)
  const lines: string[] = []
  for (const m of before) lines.push(`Cliente (antes): ${head(m.content || '', 200)}`)
  if (lastStore) lines.push(`Tienda (último mensaje): ${tail(lastStore.content || '', 300)}`)
  // SecureDog r9 F3: the whole burst (up to 12 bubbles), the planned text once (photo + text repeats the last bubble).
  const all = burst.length && clean(burst[burst.length - 1]) === clean(inboundText) ? [...burst] : [...burst, inboundText]
  const recent = all.slice(-12)
  // A lone message keeps 900 chars (verifier r11); a long burst shares the budget, at least 200 each.
  const per = Math.min(900, Math.max(200, Math.floor(2400 / recent.length) - 3))
  const unanswered = recent.map((t) => headTail(t, per)).join(' / ')
  lines.push(`Cliente (SIN RESPONDER, lo que decidís): ${unanswered.length > 3600 ? `…${unanswered.slice(-3600)}` : unanswered}`)
  return `<MENSAJES>\n${lines.join('\n')}\n</MENSAJES>`
}

/** Strict: exactly {claim: boolean, kind: one of the five}; anything else is an error (the caller fails closed). */
export function parsePaymentCheckVerdict(raw: string): { verdict: PaymentCheckVerdict; kind: string | null } {
  let data: unknown
  try {
    data = JSON.parse((raw || '').trim())
  } catch {
    return { verdict: 'error', kind: null }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { verdict: 'error', kind: null }
  const o = data as Record<string, unknown>
  const keys = Object.keys(o).sort().join(',')
  const kinds = ['already_paid', 'charge_complaint', 'refund', 'payment_problem', 'none']
  if (keys !== 'claim,kind' || typeof o.claim !== 'boolean' || typeof o.kind !== 'string' || !kinds.includes(o.kind)) {
    return { verdict: 'error', kind: null }
  }
  // A "claim" with kind "none" or a "clear" with a claim kind is contradictory → treat as a claim (fail closed).
  if (o.claim === true || o.kind !== 'none') return { verdict: 'claim', kind: o.kind === 'none' ? 'already_paid' : o.kind }
  return { verdict: 'clear', kind: 'none' }
}
