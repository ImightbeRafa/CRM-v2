/**
 * Payment identifiers are never typed by the model (SecureDog INT-69, 2026-10-09). The model writes the token
 * [[DATOS_PAGO]]; code replaces it with the configured payment details — only when they may be shared — and any
 * other 8+ digit number next to payment words (or any CR IBAN) in a reply must be a configured one or one the
 * customer wrote, or the reply is held for a person. Pure.
 */
import {
  canSharePaymentFacts,
  formatIban,
  formatSinpeNumber,
  joinEs,
  paymentLabelOptions,
  paymentMethodLabels,
  paymentMethodsOf,
  PAYMENT_METHOD_TOKENS,
  PAYMENT_TOKEN,
  type BrandFacts,
} from '@/lib/soft-ai/brand-facts'

export { PAYMENT_TOKEN, PAYMENT_METHOD_TOKENS }

/** A method that has its own token ([[PAGO_SINPE]] …). */
export type TokenPaymentMethod = keyof typeof PAYMENT_METHOD_TOKENS

/**
 * Sales-flow extras (agent-sales-context): contra entrega may be offered by a shipping method (Config › Métodos de
 * envío) rather than by the brand facts; codNote is its zone line ("Solo dentro del GAM.").
 */
export type PaymentFillOptions = {
  codAvailable?: boolean
  codNote?: string | null
  /**
   * The method the customer CHOSE this turn (sales-state). A contra-entrega / efectivo block only counts as an order
   * ready for a person when the customer chose that method; otherwise it is just information (Verifier 2026-10-16).
   */
  chosenMethod?: string | null
  /**
   * Sleeping exam C6 (Rafael's rule): at the close, the delivery data list goes BEFORE the payment-method question, in
   * its own message (sales-state salesDataListFirst: the list was not asked yet and the customer gave no data). Not
   * used by the token fill itself; applyFinalOutputPolicy orders the reply.
   */
  dataListFirst?: 'shipping' | 'pickup' | null
  /**
   * luna-10 exam (Rafael's rule, 2026-10-16): [[DATOS_PAGO]] = every method's DETAILS only when the customer asked for
   * the details ("pasame los datos / el número / la cuenta"). "¿Cómo puedo pagar?" / "¿se puede con tarjeta?" get the
   * method names and the question "¿Cuál preferís?" instead (Luna wrote [[DATOS_PAGO]] for those). Undefined = old
   * behaviour (callers without the customer text).
   */
  customerText?: string | null
}

/** The customer explicitly asked for the payment details (numbers / account / all the data). */
const ASKS_PAYMENT_DETAILS_RE =
  /(?<![\p{L}])(datos|n[uú]mero|cuenta|iban|a\s+nombre\s+de|(a\s+)?d[oó]nde\s+(te\s+|les\s+|le\s+)?(pago|deposito|deposit[oa]|transfiero|mando|hago\s+el\s+sinpe)|todos\s+los\s+(m[eé]todos|datos)|info(rmaci[oó]n)?\s+para\s+pagar|(me\s+)?(pas[aá]s?|pasame|pas[eé]me|d[aá]me|mand[aá]me|regal[aá]me)\s+(el|la|los)\s+(sinpe|cuenta|iban|datos|n[uú]mero)|cu[aá]l\s+es\s+(el|la)\s+(sinpe|cuenta|iban))(?![\p{L}])/iu

export function customerAskedPaymentDetails(text: string | null | undefined): boolean {
  return ASKS_PAYMENT_DETAILS_RE.test(text || '')
}

/** "Tenemos SINPE Móvil, tarjeta y contra entrega (GAM). ¿Cuál preferís?" — names only, from configuration. */
export function paymentMethodsQuestion(facts: BrandFacts): string {
  const labels = paymentMethodLabels(paymentMethodsOf(facts), paymentLabelOptions(facts))
  // Verifier round 4: the sales flow's own method question (PAYMENT_METHOD_ASKED_RE) — the next "SINPE" is a choice.
  return labels.length ? `Tenemos ${joinEs(labels)}. ¿Cómo preferís pagar?` : ''
}

/** Owner text as one clean line (no blank lines can ever split a payment block into two messages). */
const oneLine = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim()
const sentence = (s: string) => {
  const t = oneLine(s)
  if (!t) return ''
  const cap = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?…)]$/.test(cap) ? cap : `${cap}.`
}

function sinpeBlock(facts: BrandFacts): string {
  const s = facts.payment?.sinpe
  if (!s?.number) return ''
  return [`SINPE Móvil: ${formatSinpeNumber(s.number)}`, s.holderName ? `A nombre de: ${oneLine(s.holderName)}` : ''].filter(Boolean).join('\n')
}

function transferBlock(facts: BrandFacts): string {
  const t = facts.payment?.transfer
  if (!t?.iban && !t?.bank) return ''
  // Bank only (no IBAN / holder): still recognisable as given details (sales-state PAYMENT_BLOCK_RE).
  if (!t.iban && !t.holderName) return `Transferencia bancaria: ${oneLine(t.bank)}`
  return [
    t.bank ? `Transferencia ${oneLine(t.bank)}` : 'Transferencia bancaria',
    t.iban ? `IBAN: ${formatIban(t.iban)}` : '',
    t.holderName ? `A nombre de: ${oneLine(t.holderName)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function cardBlock(facts: BrandFacts): string {
  const url = oneLine(facts.payment?.cardUrl || facts.website || '')
  return url ? `Podés pagar con tarjeta en ${url}` : ''
}

function codBlock(facts: BrandFacts, opts: PaymentFillOptions): string {
  const note = sentence(facts.shipping?.contraEntrega?.text || '')
  const body = note || ['Pagás al recibir el pedido, al mensajero.', sentence(opts.codNote || '')].filter(Boolean).join(' ')
  // "Pago contra entrega:" makes the block recognisable as given details (sales-state PAYMENT_BLOCK_RE).
  return ['Pago contra entrega:', body].join('\n')
}

function cashBlock(facts: BrandFacts): string {
  const body = sentence(facts.payment?.instructionsText || '') || 'Pagás en efectivo al recibir o al retirar el pedido.'
  return ['Pago en efectivo:', body].join('\n')
}

/** Methods whose token code may fill: configured (or COD offered by shipping) AND with the data that method needs. */
function methodAvailable(facts: BrandFacts, method: TokenPaymentMethod, opts: PaymentFillOptions): boolean {
  const methods = paymentMethodsOf(facts)
  if (method === 'contra_entrega') return methods.includes('contra_entrega') || opts.codAvailable === true
  return methods.includes(method)
}

/**
 * One method's details, vertical and readable (agents2-format 2026-10-16). Empty when payment details may not be
 * shared, the method is not offered, or its data is missing (the reply then needs a person).
 *   SINPE: "SINPE Móvil: 6201 9914\nA nombre de: Rafael García"
 *   Transferencia: "Transferencia BAC\nIBAN: CR05 0152 …\nA nombre de: …"
 *   Tarjeta: "Podés pagar con tarjeta en https://…" (card link, else the brand website)
 *   Contra entrega: the store's COD text ("Pagás al recibir, al mensajero … Solo dentro del GAM.")
 */
export function paymentMethodBlock(facts: BrandFacts, method: TokenPaymentMethod, opts: PaymentFillOptions = {}): string {
  if (!canSharePaymentFacts(facts) || !methodAvailable(facts, method, opts)) return ''
  switch (method) {
    case 'sinpe':
      return sinpeBlock(facts)
    case 'transferencia':
      return transferBlock(facts)
    case 'tarjeta':
      return cardBlock(facts)
    case 'contra_entrega':
      return codBlock(facts, opts)
    case 'efectivo':
      return cashBlock(facts)
    default:
      return ''
  }
}

/**
 * Customer-facing payment details for EVERY method ([[DATOS_PAGO]]), from configuration only, vertical (one block
 * per method, single line breaks — never a blank line, so the whole block stays in one message). Empty when they may
 * not be shared.
 */
export function paymentDetailsText(facts: BrandFacts): string {
  if (!canSharePaymentFacts(facts)) return ''
  const blocks = [sinpeBlock(facts), transferBlock(facts)].filter(Boolean)
  const others = paymentMethodsOf(facts).filter((m) => m !== 'sinpe' && m !== 'transferencia')
  const labels = paymentMethodLabels(others, paymentLabelOptions(facts))
  if (labels.length) blocks.push(`${blocks.length ? 'También' : 'Podés pagar con'}: ${joinEs(labels)}`)
  return blocks.join('\n')
}

/** Every payment token and its near-misses ("[DATOS_PAGO]", "[[datos pago]]", "[PAGO SINPE]", "[[PAGO_CONTRAENTREGA]]"). */
export const ANY_PAYMENT_TOKEN_RE =
  /\[{1,2}\s*(?:DATOS[\s_-]?PAGO|PAGO[\s_-]?(?:SINPE|TRANSFERENCIA|TARJETA|CONTRA[\s_-]?ENTREGA|EFECTIVO))\s*\]{1,2}/giu

function tokenMethod(token: string): TokenPaymentMethod | 'all' {
  const t = token.toUpperCase()
  if (/SINPE/.test(t)) return 'sinpe'
  if (/TRANSFERENCIA/.test(t)) return 'transferencia'
  if (/TARJETA/.test(t)) return 'tarjeta'
  if (/CONTRA/.test(t)) return 'contra_entrega'
  if (/EFECTIVO/.test(t)) return 'efectivo'
  return 'all'
}

/**
 * Replace every payment token with its configured details, each block on its own lines. A token whose details may
 * not be shared (sharing off, method not offered, data missing) is dropped and the reply needs a person.
 * `methods`: what was filled ('all' = [[DATOS_PAGO]]) — e.g. a filled contra-entrega token is an order ready for a person.
 */
const METHOD_WORDS: Array<[string, RegExp]> = [
  ['sinpe', /sinpe/iu],
  ['transferencia', /transfer|iban|cuenta\s+banc|dep[oó]sit/iu],
  ['tarjeta', /tarjeta|link|enlace/iu],
  ['contra_entrega', /contra\s*entrega|al\s+recibir|efectivo/iu],
]
/** The customer's text names a payment method other than the chosen one ("¿y si pago por sinpe…?"). */
function namesAnotherMethod(text: string, chosen: string): boolean {
  return METHOD_WORDS.some(([m, re]) => m !== chosen && re.test(text))
}

export function fillPaymentToken(
  text: string,
  facts: BrandFacts,
  opts: PaymentFillOptions = {},
): { text: string; needsHuman: boolean; methods: Array<TokenPaymentMethod | 'all'> } {
  const re = new RegExp(ANY_PAYMENT_TOKEN_RE.source, 'giu')
  if (!re.test(text)) return { text, needsHuman: false, methods: [] }
  let needsHuman = false
  const methods: Array<TokenPaymentMethod | 'all'> = []
  const filledOnce = new Set<string>()
  const out = text.replace(new RegExp(ANY_PAYMENT_TOKEN_RE.source, 'giu'), (token: string, offset: number, whole: string) => {
    const method = tokenMethod(token)
    // The same token twice (a saved reply with the SINPE number AND its holder) → one block only.
    if (filledOnce.has(method)) return ''
    filledOnce.add(method)
    // [[DATOS_PAGO]] without a request for the details → the method names + "¿Cuál preferís?" (no numbers).
    const namesOnly = method === 'all' && opts.customerText !== undefined && !opts.chosenMethod && !customerAskedPaymentDetails(opts.customerText)
    if (namesOnly && canSharePaymentFacts(facts)) {
      const question = paymentMethodsQuestion(facts)
      if (question) return question
    }
    // Verifier round 5: [[DATOS_PAGO]] after the customer chose a method → only that method's block (no SINPE + IBAN
    // dump when they said "contra entrega"); a chosen method we can't fill falls back to the full list.
    // Verifier round 6: never narrowed to contra entrega / efectivo (an order hand-off belongs to the explicit
    // [[PAGO_CONTRA_ENTREGA]] token once the order data is complete), and not when the customer now names another method.
    const chosen =
      method === 'all' &&
      (opts.chosenMethod === 'sinpe' || opts.chosenMethod === 'transferencia' || opts.chosenMethod === 'tarjeta') &&
      !namesAnotherMethod(opts.customerText ?? '', opts.chosenMethod)
        ? (opts.chosenMethod as TokenPaymentMethod)
        : null
    const chosenBlock = chosen ? paymentMethodBlock(facts, chosen, opts) : ''
    const filled: TokenPaymentMethod | 'all' = chosenBlock && chosen ? chosen : method
    const block = chosenBlock || (method === 'all' ? paymentDetailsText(facts) : paymentMethodBlock(facts, method, opts))
    if (!block) {
      needsHuman = true
      return ''
    }
    // contra entrega / efectivo count as an order for a person only when the customer CHOSE that method; otherwise
    // the same block is just information (no order_ready hand-off).
    const orderMethod = filled === 'contra_entrega' || filled === 'efectivo'
    if (!methods.includes(filled) && (!orderMethod || opts.chosenMethod === filled)) methods.push(filled)
    // The block always sits on its own lines ("Perfecto 🙌 [[PAGO_SINPE]]" → "Perfecto 🙌\nSINPE Móvil: …").
    const before = whole.slice(0, offset)
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1)
    const lineAfter = whole.slice(offset + token.length).split('\n')[0]
    return `${lineBefore.trim() ? '\n' : ''}${block}${lineAfter.trim() ? '\n' : ''}`
  })
  const tidy = out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: tidy, needsHuman, methods }
}

const digitsOf = (s: string) => s.replace(/\D/g, '')
export const PAY_WORDS_RE = /sinpe|iban|cuenta|transfer|dep[oó]sit|pag(ar|o|ás|as|ues)|n[uú]mero|plata|dinero|mand[aá]/iu
// Digits joined by any common separator: spaces, dots, dashes (incl. en/em dash, minus, "--"), slashes, middle dots,
// "_" (up to 4) — INT-105. A comma is NOT a digit separator (INT-113: "Tallas 36,38,40,42", "9,900 - 12,900",
// "135,140,150,160 cm" are lists / prices); comma-joined digits count only right after a payment cue
// (commaPaymentNumbers, round 4).
export const DIGIT_SEP = '[\\s.\\-\\u2010-\\u2015\\u2212/·_]{0,4}'
const SEP = DIGIT_SEP
export const CR_IBAN_RE = new RegExp(`CR${SEP}\\d{2}(?:${SEP}\\d){18}`, 'giu')
/** 8+ digits with separators, optional +506 (a SINPE / phone / account number). */
export const LONG_NUMBER_RE = new RegExp(`(?:\\+?506${SEP})?\\d(?:${SEP}\\d){7,}`, 'gu')

/** The same shapes inside ONE line (no line break as a separator). */
const LINE_SEP = '[ \\t.\\-\\u2010-\\u2015\\u2212/·_]{0,4}'
const LINE_IBAN_RE = new RegExp(`CR${LINE_SEP}\\d{2}(?:${LINE_SEP}\\d){18}`, 'giu')
const LINE_NUMBER_RE = new RegExp(`(?:\\+?506${LINE_SEP})?\\d(?:${LINE_SEP}\\d){7,}`, 'gu')

/** Digit groups joined by commas (with or without a space): "88,88,12,34", "8888, 1234", "CR05,0152,0200,…". */
const COMMA_RUN_RE = /(?<![\d,])\d{1,4}(?:,\s?\d{1,4})+(?!\d)/g
/** A payment cue at most ~4 words before the digits (sinpe, cuenta, IBAN, transferí, depositá, número, "al", "pagá a", CR). */
const PAY_CUE_BEFORE_RE =
  /(?<![\p{L}])(?:sinpe|cuenta|iban|transfer\p{L}*|dep[oó]sit\p{L}*|n[uú]mero|al|pag\p{L}*|plata|dinero|datos|cr)(?![\p{L}])[^\p{L}\p{N}]*(?:[\p{L}\p{N}]+[^\p{L}\p{N}]+){0,4}$/iu

/**
 * INT-113 / round 4: comma-joined digit runs of 8+ digits that come right after a payment cue are payment numbers
 * ("SINPE al 88,88,12,34", "cuenta 8888, 1234"). Size lists and price ranges without such a cue are not ("Tallas
 * 36,38,40,42. ¿Cómo querés pagar?" — the cue comes after the digits). A ₡ / $ amount is never one.
 */
export function commaPaymentNumbers(text: string): string[] {
  const t = (text || '').normalize('NFKC')
  const out: string[] = []
  for (const m of t.matchAll(COMMA_RUN_RE)) {
    if (digitsOf(m[0]).length < 8) continue
    const at = m.index ?? 0
    const before = t.slice(Math.max(0, at - 80), at)
    if (/[₡¢$]\s?$/.test(before)) continue
    const phoneShape = /^\d{4},\s?\d{4}$/.test(m[0])
    // "12,900, 15,900" / "2,500, 3,000": a comma + space separates list items; it joins digit groups only in the
    // exact phone shape "8888, 1234" (SecureDog round-4 note).
    if (/,\s/.test(m[0]) && !phoneShape) continue
    // The exact "8888,1234" shape is a payment number whenever the text talks about payment anywhere (round 3 rule,
    // restored: "Pago 8888,1234", "8888,1234 a nombre de Juan, pagás por SINPE"); other runs need a cue right before.
    if ((phoneShape && PAY_WORDS_RE.test(t)) || PAY_CUE_BEFORE_RE.test(before)) out.push(m[0])
  }
  return out
}

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
  const raw = (input.text || '').normalize('NFKC')
  const configured = configuredNumbers(input.facts)
  const shareable = canSharePaymentFacts(input.facts)
  const okNumber = (d: string) => shareable && configured.some((c) => sameNumber(c, d))
  // Verifier 2026-10-16: a configured number on its own line ("SINPE Móvil: 6201 9914") is set aside first, so a
  // line break never joins it with the digits that follow ("…9914" then "15000"). Planted numbers split across lines are
  // still joined and checked below.
  const text = shareable
    ? raw
        .replace(LINE_IBAN_RE, (m) => (okNumber(digitsOf(m)) ? ' [dato configurado] ' : m))
        .replace(LINE_NUMBER_RE, (m) => (okNumber(digitsOf(m)) ? ' [dato configurado] ' : m))
    : raw

  for (const m of text.match(CR_IBAN_RE) ?? []) {
    if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
  }
  if (PAY_WORDS_RE.test(text)) {
    for (const m of text.match(LONG_NUMBER_RE) ?? []) {
      if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
    }
  }
  for (const m of commaPaymentNumbers(text)) {
    if (!okNumber(digitsOf(m))) reasons.add('payment_number_unsourced')
  }
  if (!shareable) {
    const all = digitsOf(raw)
    if (configured.some((c) => all.includes(c.slice(-8)))) reasons.add('payment_number_not_shareable')
  }
  return [...reasons]
}
