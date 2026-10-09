/**
 * Payment identifiers are never typed by the model (SecureDog INT-69, 2026-10-09). The model writes the token
 * [[DATOS_PAGO]]; code replaces it with the configured payment details — only when they may be shared — and any
 * other 8+ digit number next to payment words (or any CR IBAN) in a reply must be a configured one or one the
 * customer wrote, or the reply is held for a person. Pure.
 */
import { canSharePaymentFacts, PAYMENT_TOKEN, type BrandFacts } from '@/lib/soft-ai/brand-facts'

export { PAYMENT_TOKEN }

const METHOD_LABEL: Record<string, string> = {
  sinpe: 'SINPE Móvil',
  transferencia: 'transferencia',
  tarjeta: 'tarjeta',
  efectivo: 'efectivo',
  contra_entrega: 'contra entrega',
}

/** Customer-facing payment details, from configuration only. Empty when they may not be shared. */
export function paymentDetailsText(facts: BrandFacts): string {
  if (!canSharePaymentFacts(facts)) return ''
  const p = facts.payment!
  const parts: string[] = []
  if (p.sinpe?.number) parts.push(`SINPE Móvil ${p.sinpe.number}${p.sinpe.holderName ? ` a nombre de ${p.sinpe.holderName}` : ''}`)
  if (p.transfer?.iban || p.transfer?.bank) {
    parts.push(`transferencia ${[p.transfer.bank, p.transfer.iban].filter(Boolean).join(' ')}${p.transfer.holderName ? ` a nombre de ${p.transfer.holderName}` : ''}`)
  }
  const others = (p.methods || []).filter((m) => m !== 'sinpe' && m !== 'transferencia').map((m) => METHOD_LABEL[m] || m)
  if (others.length) parts.push(`también ${others.join(', ')}`)
  return parts.join(' · ')
}

/** Token and its near-misses the model may write ("[DATOS_PAGO]", "[[datos pago]]"). */
const TOKEN_RE = /\[{1,2}\s*DATOS[\s_-]?PAGO\s*\]{1,2}/giu

/** Replace the token (or drop it when sharing is off → the reply needs a person). */
export function fillPaymentToken(text: string, facts: BrandFacts): { text: string; needsHuman: boolean } {
  if (!TOKEN_RE.test(text)) return { text, needsHuman: false }
  TOKEN_RE.lastIndex = 0
  const details = paymentDetailsText(facts)
  if (!details) return { text: text.replace(TOKEN_RE, '').replace(/[ \t]{2,}/g, ' ').trim(), needsHuman: true }
  return { text: text.replace(TOKEN_RE, details), needsHuman: false }
}

const digitsOf = (s: string) => s.replace(/\D/g, '')
const PAY_WORDS_RE = /sinpe|iban|cuenta|transfer|dep[oó]sit|pag(ar|o|ás|as|ues)|n[uú]mero|plata|dinero|mand[aá]/iu
// Digits joined by any common separator: spaces, dots, dashes (incl. en/em dash), slashes, middle dots.
const SEP = '[\\s.\\-\\u2010-\\u2015/·]{0,3}'
const CR_IBAN_RE = new RegExp(`CR${SEP}\\d{2}(?:${SEP}\\d){18}`, 'giu')
const LONG_NUMBER_RE = new RegExp(`(?:\\+?506${SEP})?\\d(?:${SEP}\\d){7,}`, 'gu')

function configuredNumbers(facts: BrandFacts): string[] {
  return [facts.payment?.sinpe?.number, facts.payment?.transfer?.iban].map((n) => digitsOf(n || '')).filter((d) => d.length >= 8)
}

/** Same number, allowing a +506 prefix on either side. */
function sameNumber(a: string, b: string): boolean {
  const strip = (d: string) => (d.length === 11 && d.startsWith('506') ? d.slice(3) : d)
  return strip(a) === strip(b)
}

/**
 * Payment-looking numbers in a reply that are not the configured ones. Customer-written numbers are NOT exempt
 * (re-check 2026-10-09: "sí, el depósito es al 8888-8888" is the fraud). If the reply mentions payment anywhere,
 * EVERY 8+ digit run in it is checked (no sentence splitting). Also flags a configured number when sharing is off.
 */
export function paymentNumberProblems(input: { text: string; facts: BrandFacts; customerText?: string }): string[] {
  const reasons = new Set<string>()
  const text = (input.text || '').normalize('NFKC')
  const configured = configuredNumbers(input.facts)
  const shareable = canSharePaymentFacts(input.facts)
  const okNumber = (d: string) => shareable && configured.some((c) => sameNumber(c, d))

  for (const m of text.match(CR_IBAN_RE) ?? []) {
    if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
  }
  if (PAY_WORDS_RE.test(text)) {
    for (const m of text.match(LONG_NUMBER_RE) ?? []) {
      if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
    }
  }
  if (!shareable) {
    const all = digitsOf(text)
    if (configured.some((c) => all.includes(c.slice(-8)))) reasons.add('payment_number_not_shareable')
  }
  return [...reasons]
}
