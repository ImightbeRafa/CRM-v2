/**
 * Pure parts of the "¿ya pagó?" model check (llm/payment-claim-check.ts): when it runs, what it sees, how its answer
 * is read. No network, no server-only imports — unit-testable.
 */
import { hasPaymentWord } from '@/lib/soft-ai/payment-classifier'

export type PaymentCheckMode = 'off' | 'shadow' | 'enforce'
export type PaymentCheckVerdict = 'claim' | 'clear' | 'error'
export type PaymentCheckHistory = Array<{ direction: string; content?: string | null }>

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
export function paymentCheckGate(inboundText: string, history: PaymentCheckHistory): boolean {
  const text = inboundText || ''
  if (!text.trim()) return false
  if (MONEY_WORDS_RE.test(text) || hasPaymentWord(text)) return true
  const recentInbound = history.filter((m) => m.direction === 'inbound').slice(-3).map((m) => m.content || '')
  if (recentInbound.some((t) => hasPaymentWord(t))) return true
  return history.some((m) => m.direction === 'outbound' && hasPaymentWord(m.content || ''))
}

/** Last 2 customer messages + the store's last message + the current one, each cut, fenced as data. */
export function buildPaymentCheckInput(
  inboundText: string,
  history: PaymentCheckHistory,
  fence: (text: string) => string,
): string {
  const cut = (t: string, n: number) => {
    const v = fence(t || '').replace(/\s+/g, ' ').trim()
    return v.length > n ? `${v.slice(0, n)}…` : v
  }
  const lastStore = [...history].reverse().find((m) => m.direction === 'outbound')
  const prevCustomer = history.filter((m) => m.direction === 'inbound').slice(-2)
  const lines: string[] = []
  for (const m of prevCustomer) lines.push(`Cliente (antes): ${cut(m.content || '', 200)}`)
  if (lastStore) lines.push(`Tienda (último mensaje): ${cut(lastStore.content || '', 300)}`)
  lines.push(`Cliente (ÚLTIMO, el que decidís): ${cut(inboundText, 600)}`)
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
