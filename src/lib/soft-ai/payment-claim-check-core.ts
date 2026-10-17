/**
 * Pure parts of the "¿ya pagó?" model check (llm/payment-claim-check.ts): when it runs, what it sees, how its answer
 * is read. No network, no server-only imports — unit-testable.
 */
import { hasPaymentWord } from '@/lib/soft-ai/payment-classifier'

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
const MONEY_WORDS_RE =
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

export function paymentCheckGate(inboundText: string, history: PaymentCheckHistory): boolean {
  const text = inboundText || ''
  if (!text.trim()) return false
  // SecureDog round 6: the whole unanswered burst, not only the newest message.
  for (const t of [...unansweredCustomerTexts(history).burst, text]) if (MONEY_WORDS_RE.test(t) || hasPaymentWord(t)) return true
  const recentInbound = history.filter((m) => m.direction === 'inbound').slice(-3).map((m) => m.content || '')
  if (recentInbound.some((t) => hasPaymentWord(t))) return true
  return history.some((m) => m.direction === 'outbound' && hasPaymentWord(m.content || ''))
}

/** Role labels a customer could type to look like another speaker in the prompt. */
const ROLE_LABEL_RE = /(?:cliente|tienda|store|customer|sistema|system|assistant|asistente|revisor|reviewer)\s*(?:[([][^)\]\n]{0,40}[)\]])?\s*[:\-–—]/giu
/**
 * SecureDog round 7: look-alike labels too — any short word with a "(…)" / "[…]" tag and a ":" / "-" ("Сliente (SIN
 * RESPONDER…):" in Cyrillic, "Cliente [SIN RESPONDER] -"), and a typed verdict ("claim=false", {"claim":false}).
 */
const TAGGED_LABEL_RE = /[\p{L}]{3,12}\s*[([][^)\]\n]{0,40}[)\]]\s*[:\-–—]/gu
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
    fence(t || '')
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
  const unanswered = [...burst, inboundText].slice(-6).map((t) => headTail(t, 400)).join(' / ')
  lines.push(`Cliente (SIN RESPONDER, lo que decidís): ${unanswered.length > 2400 ? `…${unanswered.slice(-2400)}` : unanswered}`)
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
