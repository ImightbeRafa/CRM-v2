/**
 * Output policy for every AI-originated text: model, shortcuts, handoffs, appends.
 * Monetary amounts must match an authorized provenance class.
 */

import { extractShortcutTag } from '@/lib/soft-ai/reply-images'
import {
  purchaseSummaryRenderable,
  shippingProvenanceAmounts,
  type BrandFacts,
  type ReplyStyle,
  DEFAULT_REPLY_STYLE,
} from '@/lib/soft-ai/brand-facts'
import { hasConfirmationWording, renderShortcutTemplate, shortcutByKey, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import type { AgentIntent } from '@/lib/soft-ai/agent-intents'
import { fillPaymentToken, paymentNumberProblems } from '@/lib/soft-ai/payment-guard'
import { hasPaymentWord } from '@/lib/soft-ai/payment-classifier'

/**
 * Backstop for short payment confirmations the confirmation-wording check misses ("Sí, ya se acreditó", "Sí, lo
 * recibimos", "Todo en orden con tu sinpe"): to a message that mentions a payment, such a reply is never sent and the
 * chat goes to a person (SecureDog INT-93). Delivery wording ("te llega en 2 a 4 días") is not matched.
 */
const PAYMENT_STATUS_REPLY_RE =
  /(acredit|se\s+aplic|aplicad[oa]|reflej|(nos|me)\s+(lleg|entr)[oó]|ya\s+(nos\s+|me\s+)?(lleg|entr)[oó]|recibimos|recibido|lo\s+vimos|la\s+vimos|lo\s+tenemos|todo\s+en\s+orden|est[aá]\s+en\s+orden|es\s+correct[oa]|est[aá]\s+confirmad[oa]|qued[oó]\s+(pagad|confirmad)|lleg[oó]\s+bien|todo\s+(bien|listo|sali[oó])|ya\s+est[aá](?![\p{L}])|ya\s+se\s+hizo|(ning[uú]n|sin)\s+problema|list[oa]\s+(tu|el|su)\s+pago)/iu

export type OutputValidationResult = {
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  highlightedAmounts?: number[]
}

export type AuthorizedAmountSource = 'inventory' | 'shipping' | 'quote'

// "¢" (U+00A2) is written for the colón too (SecureDog INT-104).
const MONEY_RE = /[₡¢$]\s?\d|\d[\d.,]*\s*(colones|crc|usd)/i
/** Deals the agent may never invent (fixed rule 12, INT-72): discounts, promos, free shipping, gifts, "te lo dejo en". */
const DEAL_RE =
  // No bare "gratis" / "%" (free pickup, "100% algodón" are fine); deal phrasing only.
  /(?<![\p{L}])(descuentos?|promoci[oó]n(es)?\s+especial|oferta\s+especial|precio\s+especial|rebaj\p{L}*|env[ií]os?\s+(gratis|gratuitos?|sin\s+costo|de\s+regalo|por\s+la\s+casa)|(sale|va|queda)\s+gratis\s+el\s+env[ií]o|dos\s+por\s+uno|tres\s+por\s+dos|mitad\s+de\s+precio|medio\s+precio|te (lo|la|los|las) (dejo|rebajo|regalo)|te regalo|de regalo|por la casa|sin cobrarte|te hago (un )?precio|2x1|3x2|\d{1,2}\s?%\s*(de\s+)?(descuento|off|menos))(?![\p{L}])/iu
const DEAL_ALL_RE = new RegExp(DEAL_RE.source, 'giu')
const FREE_SHIPPING_DEAL_RE = /^(env[ií]os?\s+(gratis|gratuitos?|sin\s+costo)|(sale|va|queda)\s+gratis\s+el\s+env[ií]o)$/iu
const SPECIAL_PRICE_DEAL_RE = /^(precio\s+especial|promoci[oó]n(es)?\s+especial|oferta\s+especial)$/iu

/**
 * Every way of saying "you don't pay shipping" (SecureDog INT-86): free, included, "no te cobro el envío", ₡0, on us,
 * "te lo mando gratis". "Más el envío" / "retiro sin costo" are not matches. Negated forms ("el envío no es gratis")
 * are dropped in freeShippingWording.
 */
const FREE_SHIPPING_WORDING_RE = new RegExp(
  [
    'env[ií]os?\\s+(?:\\p{L}+\\s+){0,2}?(?:gratis|gratuitos?|sin\\s+costo|incluidos?|de\\s+regalo|por\\s+(?:la\\s+casa|nuestra\\s+cuenta|mi\\s+cuenta))',
    '(?:sale|va|queda)\\s+gratis\\s+el\\s+env[ií]o',
    'env[ií]o\\s+corre\\s+por\\s+(?:nuestra|mi)\\s+cuenta',
    'incluye(?:n)?\\s+(?:el\\s+)?env[ií]o',
    'no\\s+(?:te\\s+|le\\s+|les\\s+)?(?:cobr\\p{L}*|pag\\p{L}*)\\s+(?:el\\s+|nada\\s+de\\s+|nada\\s+por\\s+el\\s+)?env[ií]o',
    'sin\\s+(?:cargo|costo|cobro)\\s+(?:de|por|del)\\s+env[ií]o',
    'env[ií]o\\s*[:(]?\\s*(?:[₡¢]\\s?0(?![\\d.,])|gratis)',
    'te\\s+(?:lo|la|los|las)\\s+(?:mando|env[ií]o|llevo)\\s+gratis',
    // INT-92: more ways to say it.
    'env[ií]o\\s+(?:no\\s+tiene|sin)\\s+(?:ning[uú]n\\s+)?(?:costo|cargo|cobro)',
    '(?:te|se|le|les)\\s+(?:lo|la|los|las)\\s+(?:mand|envi|env[ií]|llev|despach)\\p{L}*\\s+gratis',
    'gratis\\s+(?:el|la)\\s+(?:env[ií]o|entrega|despacho)',
    '(?:entrega|despacho|delivery)\\s+(?:\\p{L}+\\s+){0,2}?(?:gratis|gratuit\\p{L}*|sin\\s+costo|incluid\\p{L}*)',
    'sin\\s+(?:costo|cargo|cobro)\\s+(?:el|del|de|por)\\s+(?:env[ií]o|entrega|despacho)',
    'no\\s+se\\s+(?:cobr|pag)\\p{L}*\\s+(?:el\\s+)?(?:env[ií]o|entrega|despacho)',
    'env[ií]o\\s+(?:\\p{L}+\\s+){0,3}?[₡¢]\\s?0(?![\\d.,])',
    'por\\s+cuenta\\s+nuestra',
    'free\\s+(?:shipping|delivery)',
  ].map((p) => `(?:${p})`).join('|'),
  'giu',
)
const NEGATED_FREE_SHIPPING_RE = /(?<![\p{L}])no(?![\p{L}])\s+(?:es|va|sale|queda|est[aá]|incluye|viene)/iu

/** Free-shipping phrases in a text (with their position), negations removed. */
export function freeShippingWording(text: string): Array<{ index: number; end: number; phrase: string }> {
  const out: Array<{ index: number; end: number; phrase: string }> = []
  for (const m of text.matchAll(FREE_SHIPPING_WORDING_RE)) {
    const phrase = m[0]
    if (NEGATED_FREE_SHIPPING_RE.test(phrase) && !/^no\s/i.test(phrase)) continue
    out.push({ index: m.index ?? 0, end: (m.index ?? 0) + phrase.length, phrase })
  }
  return out
}

/**
 * Deal wording is blocked unless the owner's active promo enables that exact kind (B1): free shipping and a special
 * price can be enabled; discounts, %, 2x1, "te lo dejo en", gifts are always blocked.
 */
export function dealProblem(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>): boolean {
  for (const m of text.matchAll(DEAL_ALL_RE)) {
    const phrase = m[1].trim()
    // Free-shipping phrasing is judged below with the wider wording list.
    if (FREE_SHIPPING_DEAL_RE.test(phrase)) continue
    if (allowed.includes('special_price') && SPECIAL_PRICE_DEAL_RE.test(phrase)) continue
    return true
  }
  if (!allowed.includes('free_shipping') && freeShippingWording(text).length > 0) return true
  return false
}

/** Wording that turns a combo fact into a promise for this customer or this order. */
const FREE_SHIPPING_EXCEPTION_RE =
  /(?<![\p{L}])(aunque|pero|hoy|primera|cortes[ií]a|regal\p{L}*|por\s+esta\s+vez|esta\s+vez|igual(?:mente)?|tambi[eé]n|excepci\p{L}*|normalmente|por\s+lo\s+general|de\s+todas\s+formas|a\s+vos|a\s+ti|para\s+vos|para\s+ti|tu\s+(?:pedido|compra|orden)|califica\p{L}*|aplica\p{L}*|te\s+lo\s+(?:dejo|mando)\s+igual|te\s+(?:lo|la|los|las)\s+(?:dejo|mando))(?![\p{L}])/iu

/**
 * Combos the owner marked as including shipping (exact prices), plus words that name other things the agent sells
 * (catalog items): a clause that names one of them is not only about the included combo (INT-91).
 */
export type FreeShippingRule = { includedPrices: number[]; otherNames?: string[] }

/** Words that stretch one combo's fact to more items, anywhere in the reply (INT-91). */
const FREE_SHIPPING_SPREAD_RE = /(?<![\p{L}])(tambi[eé]n|igual(?:mente)?|lo\s+mismo|ambos|ambas|los\s+dos|las\s+dos|todos|todas|van|incluyen|traen|vienen)(?![\p{L}])/iu
/** Bare amounts too ("17.900", "17900"), not only ₡ ones. */
const BARE_AMOUNT_RE = /\d{1,3}(?:[.,   ]\d{3})+|\d{4,7}/g

/** Clause spans: sentence ends, parentheses, line breaks (a period inside ₡25.000 is not an end). */
function clauseSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  let start = 0
  for (const m of text.matchAll(/(?:(?<!\d)\.|\.(?!\d)|[!?;()\n])+/g)) {
    spans.push([start, m.index ?? 0])
    start = (m.index ?? 0) + m[0].length
  }
  spans.push([start, text.length])
  return spans
}

/**
 * "Envío incluido / gratis" without a promo is only true for a combo the owner marked as including shipping: every
 * such phrase must sit in ONE clause (never split across a break) that says "combo", quotes only included-combo
 * prices (at least one), and has no wording that makes it personal or an exception (SecureDog INT-84/85).
 */
export function freeShippingRuleOk(text: string, rule: FreeShippingRule): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const matches = freeShippingWording(text)
  if (matches.length === 0 || rule.includedPrices.length === 0) return false
  // One included combo per fact: nothing in the reply may stretch it to other items.
  if (FREE_SHIPPING_SPREAD_RE.test(text)) return false
  const others = (rule.otherNames ?? []).map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3)
  const spans = clauseSpans(text)
  for (const m of matches) {
    const span = spans.find(([s, e]) => m.index >= s && m.index < e)
    if (!span || m.end > span[1]) return false
    const clause = text.slice(span[0], span[1])
    // Exactly one combo named in the clause (not "el Combo Trío y el Combo 2").
    if ((clause.match(/(?<![\p{L}])combos?(?![\p{L}])/giu) || []).length !== 1) return false
    if (FREE_SHIPPING_EXCEPTION_RE.test(clause)) return false
    const lower = clause.toLowerCase()
    if (others.some((n) => new RegExp(`(?<![\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(lower))) return false
    const amounts = [
      ...extractMoneyAmounts(clause).map((a) => Math.round(a)),
      ...[...clause.matchAll(BARE_AMOUNT_RE)].map((x) => Number(x[0].replace(/\D/g, ''))),
    ].filter((a) => a >= 100)
    if (amounts.length === 0) return false
    if (!amounts.every((a) => rule.includedPrices.some((p) => near(a, p)))) return false
  }
  return true
}

/** Deal check with the narrower included-combo rule on top of the promo kinds. */
function dealProblemWithRule(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>, rule: FreeShippingRule | null | undefined): boolean {
  if (!dealProblem(text, allowed)) return false
  if (!rule || allowed.includes('free_shipping')) return true
  // Only free-shipping wording is the problem, and every phrase is an included-combo fact.
  return dealProblem(text, [...allowed, 'free_shipping']) || !freeShippingRuleOk(text, rule)
}

const CREATED_CLAIM_RE = /ya\s+(cre[eé]|registr[eé]|arm[eé])|pedido\s+creado|acabo\s+de\s+crear/i
const UNIT_COST_RE = /unitCost|costo\s+unitario|precio\s+de\s+costo/i
const SHIP_CUE_RE = /env[ií]o|retiro|domicilio|\bGAM\b|correos|mensajer/i
const PAY_CUE_RE = /\b(pago|sinpe|transferencia|tarjeta|efectivo|contra\s*entrega)\b/i
const PURCHASE_INTENTS = new Set<AgentIntent>(['price', 'how_to_buy'])

export function extractMoneyAmounts(text: string): number[] {
  // NFKC: the full-width "￠" becomes "¢" (INT-104: "¢" is a colón sign too).
  const matches = (text || '').normalize('NFKC').matchAll(/[₡¢$]\s?(\d(?:[\d.\s]*\d)?)|\b(\d[\d.,]*)\s*(?:colones|crc|usd)\b/gi)
  const amounts: number[] = []
  for (const match of matches) {
    const raw = (match[1] || match[2] || '').replace(/\s/g, '')
    const normalized = raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')
    const value = Number(normalized)
    if (Number.isFinite(value) && value > 0) amounts.push(value)
  }
  return amounts
}

function amountAllowed(amount: number, allowed: number[]): boolean {
  const rounded = Math.round(amount)
  return allowed.some((candidate) => Math.abs(Math.round(candidate) - rounded) <= 1)
}

export function validateAgentOutput(input: {
  text: string
  citedToolNames: string[]
  inventoryPrices?: number[]
  shippingAmounts?: number[]
  quoteAmounts?: number[]
  replyStyle?: ReplyStyle | null
  intent?: string | null
  /** Deal wording enabled by the owner's active promo (promo.ts). */
  allowedDeals?: Array<'free_shipping' | 'special_price'>
  /** Store rule "envío gratis desde ₡X" (only valid next to that amount). */
  freeShippingRule?: FreeShippingRule | null
  /** The customer's message: a reply about the state of a payment to a payment message is never sent (INT-93). */
  customerText?: string
  /** The conversation is about a payment (recent payment words / media / payment already discussed): same backstop. */
  paymentContext?: boolean
}): OutputValidationResult {
  const reasons: string[] = []
  const text = input.text || ''
  const cited = new Set(input.citedToolNames)
  const highlighted: number[] = []

  if (UNIT_COST_RE.test(text)) reasons.push('unit_cost_leak')
  if (CREATED_CLAIM_RE.test(text)) reasons.push('write_claim')
  if (dealProblemWithRule(text, input.allowedDeals ?? [], input.freeShippingRule)) reasons.push('deal_offer')
  if (hasConfirmationWording(text)) reasons.push('confirmation_wording')
  if ((input.paymentContext || (input.customerText && hasPaymentWord(input.customerText))) && PAYMENT_STATUS_REPLY_RE.test(text)) {
    reasons.push('payment_status_claim')
  }

  const inventory =
    cited.has('search_inventory') && Array.isArray(input.inventoryPrices)
      ? input.inventoryPrices
      : []
  const shipping = input.shippingAmounts || []
  const quote = input.quoteAmounts || []
  const allowed = [...inventory, ...shipping, ...quote]
  const amounts = extractMoneyAmounts(text).filter((amount) => Math.round(amount) >= 100)

  if (MONEY_RE.test(text) && amounts.length === 0 && allowed.length === 0 && !cited.has('search_inventory')) {
    reasons.push('unsourced_money')
  }

  for (const amount of amounts) {
    if (amountAllowed(amount, allowed)) continue
    highlighted.push(Math.round(amount))
    if (!cited.has('search_inventory') && shipping.length === 0 && quote.length === 0) {
      reasons.push('unsourced_money')
    } else if (cited.has('search_inventory') && !amountAllowed(amount, inventory)) {
      reasons.push('money_mismatch_inventory')
    }
    reasons.push('unsourced_amount')
    break
  }

  const style = input.replyStyle
  if (style) {
    const lines = text.split(/\n/).filter((line) => line.trim().length > 0)
    if (lines.length > style.maxLines + 2) reasons.push('style_too_long')
  }

  const needsHuman = reasons.length > 0
  return {
    ok: !needsHuman,
    needsHuman,
    reasons: [...new Set(reasons)],
    highlightedAmounts: highlighted,
  }
}

const PAYMENT_TOKEN_LINE_RE = /\[\[?\s*DATOS[_\s]PAGO\s*\]?\]/i

/**
 * B3: keep the reply within maxLines (non-empty lines): the first lines, the [[DATOS_PAGO]] line and the last question
 * (the next step of the sale) are kept, in their original order. Pure; never adds words.
 */
export function shortenToMaxLines(text: string, maxLines: number): string {
  const lines = (text || '').split(/\n/).filter((line) => line.trim().length > 0)
  const limit = Math.max(1, Math.floor(maxLines))
  if (lines.length <= limit + 2) return text
  const keep = new Set<number>()
  const tokenLine = lines.findIndex((line) => PAYMENT_TOKEN_LINE_RE.test(line))
  if (tokenLine >= 0) keep.add(tokenLine)
  let question = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/[?¿]/.test(lines[i])) {
      question = i
      break
    }
  }
  if (question >= 0) keep.add(question)
  for (let i = 0; i < lines.length && keep.size < limit; i += 1) keep.add(i)
  // SecureDog INT-99: never drop a line that qualifies something (an amount, shipping, a negation, the assistant
  // disclosure) or holds part of a payment token — dropping it can change the meaning. Then the reply is not shortened
  // (it stays too long → the safe line goes out instead).
  const dropped = lines.filter((_, i) => !keep.has(i))
  if (dropped.some((line) => QUALIFYING_LINE_RE.test(line))) return text
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join('\n')
}

const QUALIFYING_LINE_RE = /[₡¢$]|\d{3}|env[ií]o|(?<![\p{L}])(no|nunca|sin|solo|excepto)(?![\p{L}])|asistente\s+virtual|\[\[|\]\]|DATOS|PAGO/iu

export type FinalOutputPolicy = {
  text: string
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  purchaseSummaryAppended: boolean
  highlightedAmounts: number[]
  intent: string
}

export function applyFinalOutputPolicy(input: {
  text: string
  intent?: string | null
  citedToolNames?: string[]
  inventoryPrices?: number[]
  quoteAmounts?: number[]
  brandFacts?: BrandFacts | null
  replyStyle?: ReplyStyle | null
  shortcuts?: RuntimeShortcut[]
  /** Sales flow active: it decides when shipping/payment are said, so no automatic summary (it repeated itself). */
  skipPurchaseSummary?: boolean
  /** The customer's own message (numbers they wrote may be repeated back). */
  customerText?: string
  allowedDeals?: Array<'free_shipping' | 'special_price'>
  /** Promo makes shipping free: the store's fixed shipping amounts stop being valid. */
  freeShipping?: boolean
  freeShippingRule?: FreeShippingRule | null
  /**
   * Agentes IA 2.0 (B3): a model reply longer than the style allows is shortened by code (first lines + the payment
   * line + the final question) instead of being held for a person. Off for the owner's own saved replies.
   */
  shortenLongReply?: boolean
}): FinalOutputPolicy {
  const facts = input.brandFacts || { schemaVersion: 1 }
  const style = input.replyStyle || DEFAULT_REPLY_STYLE
  const intent = (input.intent || 'other') as AgentIntent
  const shippingAmounts = input.freeShipping ? [] : shippingProvenanceAmounts(facts)
  let text = (input.text || '').trim()
  let purchaseSummaryAppended = false
  const reasons: string[] = []
  // Backstop: an unrendered template ({{brand.…}}) or a leftover [[ATAJO…]] never reaches the customer.
  if (/\{\{[^}]{0,80}\}\}/.test(text)) {
    text = text.replace(/\{\{[^}]{0,80}\}\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
    reasons.push('template_leak')
  }
  text = extractShortcutTag(text).text
  if (input.shortenLongReply) {
    const short = shortenToMaxLines(text, style.maxLines)
    if (short !== text) {
      text = short
      reasons.push('shortened')
    }
  }
  // Anything still spelling the internal tag (case-sensitive) is never sent.
  if (/ATAJO/.test(text)) reasons.push('tag_leak')
  // Nothing left to send = no reply (never an empty WhatsApp message).
  if (!text) reasons.push('empty_output')
  // Payment identifiers come from configuration only (INT-69): fill the token, then every payment-looking number
  // must be a configured one (when shareable) or one the customer wrote.
  const filled = fillPaymentToken(text, facts)
  text = filled.text
  if (filled.needsHuman) reasons.push('payment_info_not_shared')
  reasons.push(...paymentNumberProblems({ text, facts, customerText: input.customerText }))

  const hasMoney = extractMoneyAmounts(text).some((amount) => Math.round(amount) >= 100)
  const purchaseIntent = PURCHASE_INTENTS.has(intent)
  const incomplete =
    !input.skipPurchaseSummary &&
    purchaseIntent &&
    hasMoney &&
    style.purchaseInfoMustBeComplete &&
    (!SHIP_CUE_RE.test(text) || !PAY_CUE_RE.test(text))

  if (incomplete) {
    const summary = shortcutByKey(input.shortcuts || [], 'sys_purchase_summary')
    const rendered = summary
      ? renderShortcutTemplate(summary.body, { facts }).trim()
      : ''
    if (!purchaseSummaryRenderable(facts) || !rendered || !SHIP_CUE_RE.test(rendered) || !PAY_CUE_RE.test(rendered)) {
      reasons.push('brand_facts_missing')
    } else if (!text.includes(rendered)) {
      text = `${text}\n${rendered}`.trim()
      purchaseSummaryAppended = true
      reasons.push('purchase_summary_appended')
    }
  }

  const validated = validateAgentOutput({
    text,
    citedToolNames: input.citedToolNames || [],
    inventoryPrices: input.inventoryPrices,
    shippingAmounts,
    quoteAmounts: input.quoteAmounts,
    replyStyle: style,
    intent,
    allowedDeals: input.allowedDeals,
    freeShippingRule: input.freeShippingRule,
    customerText: input.customerText,
  })

  const merged = [...new Set([...reasons, ...validated.reasons])]
  const blocking = merged.filter((reason) => reason !== 'purchase_summary_appended' && reason !== 'shortened')
  return {
    text,
    ok: blocking.length === 0,
    needsHuman: blocking.length > 0,
    reasons: merged,
    purchaseSummaryAppended,
    highlightedAmounts: validated.highlightedAmounts || [],
    intent,
  }
}
