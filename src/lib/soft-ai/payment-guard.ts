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

/** Replace the token (or drop it when sharing is off → the reply needs a person). */
export function fillPaymentToken(text: string, facts: BrandFacts): { text: string; needsHuman: boolean } {
  if (!text.includes(PAYMENT_TOKEN)) return { text, needsHuman: false }
  const details = paymentDetailsText(facts)
  if (!details) return { text: text.split(PAYMENT_TOKEN).join('').replace(/[ \t]{2,}/g, ' ').trim(), needsHuman: true }
  return { text: text.split(PAYMENT_TOKEN).join(details), needsHuman: false }
}

const digitsOf = (s: string) => s.replace(/\D/g, '')
const PAY_WORDS_RE = /sinpe|iban|cuenta|transfer|dep[oó]sit|pag(ar|o|ás|as|ues)|n[uú]mero/iu
const CR_IBAN_RE = /\bCR\s?\d{2}(?:[\s-]?\d{4}){4}[\s-]?\d{2}\b/giu
const LONG_NUMBER_RE = /(?:\+?506[\s-]?)?\d(?:[\s-]?\d){7,}/g

function configuredNumbers(facts: BrandFacts): string[] {
  return [facts.payment?.sinpe?.number, facts.payment?.transfer?.iban].map((n) => digitsOf(n || '')).filter((d) => d.length >= 8)
}

/** Same number, allowing a +506 prefix on either side. */
function sameNumber(a: string, b: string): boolean {
  const strip = (d: string) => (d.length === 11 && d.startsWith('506') ? d.slice(3) : d)
  return strip(a) === strip(b)
}

/**
 * Payment-looking numbers in a reply that are neither configured nor written by the customer. Also flags a
 * configured number when sharing is off. Returns the reasons (empty = fine).
 */
export function paymentNumberProblems(input: { text: string; facts: BrandFacts; customerText?: string }): string[] {
  const reasons = new Set<string>()
  const configured = configuredNumbers(input.facts)
  const shareable = canSharePaymentFacts(input.facts)
  const customerDigits = (input.customerText || '').match(LONG_NUMBER_RE)?.map(digitsOf) ?? []
  const okNumber = (d: string) =>
    (shareable && configured.some((c) => sameNumber(c, d))) || customerDigits.some((c) => sameNumber(c, d))

  for (const m of input.text.match(CR_IBAN_RE) ?? []) {
    if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
  }
  for (const sentence of input.text.split(/(?<=[.!?\n])/)) {
    if (!PAY_WORDS_RE.test(sentence)) continue
    for (const m of sentence.match(LONG_NUMBER_RE) ?? []) {
      if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
    }
  }
  if (!shareable) {
    const all = digitsOf(input.text)
    if (configured.some((c) => all.includes(c.slice(-8)))) reasons.add('payment_number_not_shareable')
  }
  return [...reasons]
}
