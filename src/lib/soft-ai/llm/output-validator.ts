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
import { fillPaymentToken, paymentNumberProblems, type PaymentFillOptions, type TokenPaymentMethod } from '@/lib/soft-ai/payment-guard'
import { hasPaymentWord } from '@/lib/soft-ai/payment-classifier'
import { buildLinkAllowlist, foreignLinks, type LinkAllowlist } from '@/lib/soft-ai/links'
import { canonicalizeOrderDataList, SHIPPING_DATA_LIST } from '@/lib/soft-ai/order-data-list'
import { MAX_REPLY_PARTS, splitReplyParts } from '@/lib/soft-ai/reply-parts'

/**
 * Backstop for short payment confirmations the confirmation-wording check misses ("Sí, ya se acreditó", "Sí, lo
 * recibimos", "Todo en orden con tu sinpe"): to a message that mentions a payment, such a reply is never sent and the
 * chat goes to a person (SecureDog INT-93). Delivery wording ("te llega en 2 a 4 días") is not matched.
 */
const PAYMENT_STATUS_REPLY_RE =
  /(acredit|se\s+aplic|aplicad[oa]|reflej|(nos|me)\s+(lleg|entr)[oó]|ya\s+(nos\s+|me\s+)?(lleg|entr)[oó]|recibimos|recibido|lo\s+vimos|la\s+vimos|lo\s+tenemos|todo\s+en\s+orden|est[aá]\s+en\s+orden|es\s+correct[oa]|est[aá]\s+confirmad[oa]|qued[oó]\s+(pagad|confirmad)|lleg[oó]\s+bien|todo\s+(bien|listo|sali[oó])|ya\s+est[aá](?![\p{L}])|ya\s+se\s+hizo|(ning[uú]n|sin)\s+problema|list[oa]\s+(tu|el|su)\s+pago|(?<![\p{L}])(?:est[aá]|qued[oó]|sali[oó]|todo)\s+(?:ok|okay|okey|oki)(?![\p{L}])|(?:tu|el|su)\s+pago\s+(?:\p{L}+\s+)?(?:ok|okay|okey)(?![\p{L}])|(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)\s+(?:\p{L}+\s+){0,2}(?:entr[oó]|cay[oó]|lleg[oó]|est[aá]\s+(?:bien|correct|list)|qued[oó]\s+list|fue\s+recibid)|(?:ya\s+(?:lo\s+|la\s+)?(?:vimos|revisamos|verificamos|confirmamos)|(?<![\p{L}])vimos)\s+(?:tu|el|su)\s+(?:pago|sinpe|dep[oó]sito|transferencia|comprobante)|est[aá]\s+correct[oa])/iu

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
export type FreeShippingRule = { includedPrices: number[]; otherNames?: string[]; bundleWords?: string[]; nameNotes?: string[] }

const foldNote = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * A bracketed note that is word-for-word part of an owner's bundle / catalog name ("Pack 2 bolsas (60 noches)") is
 * not a clause break: blank it out (same length, so match positions stay valid). Any other bracket stays visible and
 * keeps breaking the clause — nothing can hide inside one (SecureDog INT-126).
 */
function maskNameParentheticals(text: string, nameNotes: ReadonlyArray<string>): string {
  if (!nameNotes.length) return text
  const notes = new Set(nameNotes.map(foldNote).filter(Boolean))
  return text.replace(/\(([^()\n]*)\)/g, (m, inner: string) => (notes.has(foldNote(inner)) ? ' '.repeat(m.length) : m))
}

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
export function freeShippingRuleOk(rawText: string, rule: FreeShippingRule): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1
  const text = maskNameParentheticals(rawText, rule.nameNotes ?? [])
  const extraWords = (rule.bundleWords ?? []).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
  const bundleWordRe = new RegExp(`(?<![\\p{L}])(?:combos?|packs?|kits?${extraWords.length ? '|' + extraWords.map((w) => `${w}s?`).join('|') : ''})(?![\\p{L}])`, 'giu')
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
    // Exactly one combo / pack named in the clause (not "el Combo Trío y el Combo 2").
    if ((clause.match(bundleWordRe) || []).length !== 1) return false
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

// Everywhere: "ya creé / registré", and (N3) "tu pedido / tu orden / tu compra" + a confirmation verb. Not "sale
// mañana" (a delivery time) nor "tu pedido está listo para retirar".
const CREATED_CLAIM_RE =
  /ya\s+(cre[eé]|registr[eé]|arm[eé])|pedido\s+creado|acabo\s+de\s+crear|(?:tu|su)\s+(?:pedido|orden|compra)\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+|fue\s+)?(?:registrad|anotad|confirmad|agendad)[oa]/iu
/**
 * SecureDog INT-117 (+ residual): ONLY on the contra-entrega / efectivo closing turn the agent must not make up the
 * order's confirmation or schedule — a person confirms after the order_ready hand-off.
 */
const ORDER_CLOSING_CLAIM_RE =
  /pedido\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+)?(?:registrad|anotad|agendad|confirmad|list)[oa]|(?:orden|compra)\s+(?:ya\s+)?(?:qued[oó]\s+|est[aá]\s+)?(?:registrad|anotad|agendad|confirmad|list)[oa]|(?<![\p{L}])agend[eé](?![\p{L}])|anot[eé]\s+(?:tu|el|su)\s+pedido|sale\s+(?:hoy|ma[nñ]ana)|te\s+(?:lo|la|los|las)\s+mando\s+(?:hoy|ma[nñ]ana)|ma[nñ]ana\s+te\s+llega|(?:queda|qued[oó])\s+(?:programad|agendad)\p{L}*|te\s+(?:lo|la|los|las)\s+despachamos|va\s+en\s+camino|tu\s+entrega\s+(?:queda|est[aá])\s+(?:para|agendada)/iu
const UNIT_COST_RE = /unitCost|costo\s+unitario|precio\s+de\s+costo/i
const SHIP_CUE_RE = /env[ií]o|retiro|domicilio|\bGAM\b|correos|mensajer/i
const PAY_CUE_RE = /\b(pago|sinpe|transferencia|tarjeta|efectivo|contra\s*entrega)\b/i
const PURCHASE_INTENTS = new Set<AgentIntent>(['price', 'how_to_buy'])

export function extractMoneyAmounts(text: string): number[] {
  // NFKC: the full-width "￠" becomes "¢" (INT-104: "¢" is a colón sign too).
  // "N mil" / "Nmil" is N × 1000 next to a currency sign or colones ("₡15 mil", "15 mil colones"); sign-less unless a
  // count noun follows (bareMilAmounts, round 4). "₡9.900 mil gracias" is ₡9.900 (R4).
  const t = (text || '').normalize('NFKC')
  const amounts: number[] = []
  for (const match of t.matchAll(MONEY_AMOUNT_RE)) {
    const spaced = match[1] || match[3] || ''
    const raw = spaced.replace(/\s/g, '')
    const thousand = Boolean(match[2] || match[4]) && !hasThousandsSeparator(spaced)
    const normalized = raw.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')
    const value = Number(normalized) * (thousand ? 1000 : 1)
    if (Number.isFinite(value) && value > 0) amounts.push(value)
  }
  return [...amounts, ...bareMilAmounts(t)]
}

/** "9.900", "12,900", "12 900": already a full amount — a following "mil" is not a multiplier (R4). */
export function hasThousandsSeparator(digits: string): boolean {
  return /\d[.,\s]\d{3}(?!\d)/.test(digits)
}

/**
 * Count / unit nouns: "N mil" right before one of these (optionally after "de") is a count, not money (round 4,
 * INT-104 reopened — a blocklist, so any other wording of a price stays checked).
 */
export const MIL_COUNT_WORDS = [
  'pasos', 'mah', 'ml', 'mg', 'g', 'gr', 'kg', 'km', 'metros', 'm', 'cm', 'unidades', 'personas', 'clientes', 'seguidores',
  'reseñas', 'comentarios', 'vendidos', 'vendidas', 'ventas', 'pedidos', 'familias', 'parches', 'productos', 'años',
  'horas', 'minutos', 'likes', 'visitas', 'compras', 'usuarios', 'envíos', 'envios', 'veces', 'opiniones', 'fans',
]

/**
 * Sign-less "N mil" amounts (round 4): money UNLESS a count / unit noun follows ("5 mil parches", "2 mil reseñas",
 * "10 mil pasos", "5 mil mAh", "más de 5 mil pedidos"). "Por 15 mil te lo llevás", "Está en 15 mil", "Son 15 mil
 * pesos", "Cuesta 15 mil exactos", "Son 5 mil parches por 4 mil" (→ 4 000) are money. One helper for the live
 * validator and the save-time check (agent-tuning-core colonAmountsIn). `extraCountWords`: e.g. the agent's product
 * name tokens, when the caller has them.
 */
export function bareMilAmounts(text: string, extraCountWords: readonly string[] = []): number[] {
  const t = (text || '').normalize('NFKC')
  const counts = new Set([...MIL_COUNT_WORDS, ...extraCountWords.map((w) => w.toLowerCase())])
  const out: number[] = []
  for (const m of t.matchAll(/(?<![\d.,₡¢$\p{L}])(\d{1,3})\s*mil(?![\p{L}])/giu)) {
    const after = t.slice((m.index ?? 0) + m[0].length)
    if (/^\s*(?:colones|crc|usd)(?![\p{L}])/iu.test(after)) continue // counted with its currency word
    const next = after.match(/^\s+(?:de\s+)?(\p{L}+)/iu)?.[1]?.toLowerCase()
    if (next && counts.has(next)) continue
    out.push(Number(m[1]) * 1000)
  }
  return out
}

/**
 * INT-112: what a model reply may link — brand website / catalog, the maps URL when it is a map link, and links the
 * owner wrote in active saved replies and approved bound knowledge (links.ts buildLinkAllowlist).
 */
export function brandFactsLinkAllowlist(
  facts: Pick<BrandFacts, 'website' | 'catalogUrl' | 'location'> | null | undefined,
  ownerTexts: Array<string | null | undefined> = [],
): LinkAllowlist {
  // The card link ([[PAGO_TARJETA]]) is NOT added here: links are checked before code fills it (applyFinalOutputPolicy).
  return buildLinkAllowlist({ website: facts?.website, catalogUrl: facts?.catalogUrl, mapsUrl: facts?.location?.mapsUrl, ownerTexts })
}

const MONEY_AMOUNT_RE =
  /[₡¢$]\s?(\d(?:[\d.\s]*\d)?)(\s*mil(?![\p{L}]))?|(?<![\d.,\p{L}])(\d[\d.,]*)(\s*mil)?\s*(?:colones|crc|usd)(?![\p{L}])/giu

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
  /**
   * INT-109 / INT-112: what the reply may link (brandFactsLinkAllowlist). When given, any other link or domain in the
   * reply is 'foreign_link' (nothing configured → every link is foreign). Undefined = not checked.
   */
  linkAllowlist?: LinkAllowlist | null
  /**
   * The text the length rule is judged on (agents2-format): the reply BEFORE payment tokens were filled, so a
   * configured payment block counts as the one line the token was. Defaults to `text`.
   */
  styleText?: string
  /** The text links are judged on (the reply before payment tokens were filled). Defaults to `text`. */
  linkText?: string
  /** N3: the contra-entrega / efectivo closing turn — the order-confirmation wording check applies. */
  orderClosing?: boolean
}): OutputValidationResult {
  const reasons: string[] = []
  const text = input.text || ''
  const cited = new Set(input.citedToolNames)
  const highlighted: number[] = []

  // Links are judged on the text BEFORE code filled payment tokens (linkText): the card link code adds from
  // configuration needs no allowlist entry, and the allowlist never widens to a whole payment host (Verifier F2).
  if (input.linkAllowlist && foreignLinks(input.linkText ?? text, input.linkAllowlist).length > 0) reasons.push('foreign_link')
  if (UNIT_COST_RE.test(text)) reasons.push('unit_cost_leak')
  if (CREATED_CLAIM_RE.test(text) || (input.orderClosing && ORDER_CLOSING_CLAIM_RE.test(text))) reasons.push('write_claim')
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
    // agents2-format: the limit is PER MESSAGE (each blank-line block goes out on its own, max 3), a dash list counts
    // as one line.
    const parts = splitReplyParts(input.styleText ?? text)
    if (parts.some((part) => messageLineCount(part) > style.maxLines + 2)) reasons.push('style_too_long')
  }

  const needsHuman = reasons.length > 0
  return {
    ok: !needsHuman,
    needsHuman,
    reasons: [...new Set(reasons)],
    highlightedAmounts: highlighted,
  }
}

/** Any payment token line ([[DATOS_PAGO]], [[PAGO_SINPE]], …, also with one bracket). */
const PAYMENT_TOKEN_LINE_RE = /\[\[?\s*(?:DATOS[_\s-]?PAGO|PAGO[_\s-]?(?:SINPE|TRANSFERENCIA|TARJETA|CONTRA[_\s-]?ENTREGA|EFECTIVO))\s*\]?\]/i

// agents2-format: a reply goes out as separate messages (reply-parts.ts, client-safe).
export { MAX_REPLY_PARTS, splitReplyParts }

const LIST_ITEM_RE = /^\s*(?:[-•*–]|\d{1,2}[.)])\s+\S/

/** A dash list counts as one line only up to this many items (a longer list counts item by item). */
export const LIST_AS_ONE_LINE_MAX = 8
/**
 * The fixed shipping data list (7) + business fields: up to this many items still count as one line, so a data
 * request is never "too long" (2026-10-16). Only for a list that holds the fixed list.
 */
export const DATA_LIST_AS_ONE_LINE_MAX = 12

/** Lines of one message: a run of list items ("- …", "• …", "1. …") counts as ONE line (up to 8 items). */
export function messageLineCount(part: string): number {
  return unitsWeight(messageUnits(part))
}

const unitWeight = (unit: string[]) => {
  const max = unit.length > LIST_AS_ONE_LINE_MAX && unit.join('\n').includes(SHIPPING_DATA_LIST) ? DATA_LIST_AS_ONE_LINE_MAX : LIST_AS_ONE_LINE_MAX
  return unit.length > max ? unit.length : 1
}
const unitsWeight = (units: string[][]) => units.reduce((n, u) => n + unitWeight(u), 0)

/** Units of one message: a single line, or a whole run of list items. */
function messageUnits(part: string): string[][] {
  const units: string[][] = []
  let list: string[] | null = null
  for (const line of (part || '').split('\n')) {
    if (!line.trim()) {
      list = null
      continue
    }
    if (LIST_ITEM_RE.test(line)) {
      if (!list) {
        list = []
        units.push(list)
      }
      list.push(line)
    } else {
      list = null
      units.push([line])
    }
  }
  return units
}

/** Shorten ONE message (B3 rules, per message): null when it cannot be shortened safely. */
function shortenPart(part: string, limit: number): string | null {
  const units = messageUnits(part)
  if (unitsWeight(units) <= limit + 2) return part
  const keep = new Set<number>()
  units.forEach((unit, i) => {
    // A payment token and a list (the data the customer must send) are never dropped.
    if (unit.some((line) => PAYMENT_TOKEN_LINE_RE.test(line)) || unit.length > 1 || LIST_ITEM_RE.test(unit[0])) keep.add(i)
  })
  for (let i = units.length - 1; i >= 0; i -= 1) {
    if (unit2text(units[i]).match(/[?¿]/)) {
      keep.add(i)
      break
    }
  }
  const kept = () => unitsWeight([...keep].map((i) => units[i]))
  for (let i = 0; i < units.length && kept() < limit; i += 1) keep.add(i)
  // SecureDog INT-99: never drop a line that qualifies something (an amount, shipping, a negation, the assistant
  // disclosure) or holds part of a payment token — dropping it can change the meaning. Then the reply is not shortened
  // (it stays too long → the safe line goes out instead).
  const dropped = units.filter((_, i) => !keep.has(i)).flat()
  if (dropped.some((line) => QUALIFYING_LINE_RE.test(line))) return null
  return [...keep].sort((a, b) => a - b).map((i) => unit2text(units[i])).join('\n')
}

const unit2text = (unit: string[]) => unit.join('\n')

/**
 * B3: keep each message within maxLines (agents2-format: per message, a list counts as one line): the first lines, the
 * payment-token line, every list and the last question (the next step of the sale) are kept, in their original order.
 * Pure; never adds words. Unchanged text when nothing needs (or may be) shortened.
 */
export function shortenToMaxLines(text: string, maxLines: number): string {
  const limit = Math.max(1, Math.floor(maxLines))
  const parts = splitReplyParts(text)
  if (parts.every((part) => messageLineCount(part) <= limit + 2)) return text
  const out: string[] = []
  for (const part of parts) {
    const short = shortenPart(part, limit)
    if (short === null) return text
    out.push(short)
  }
  return out.join('\n\n')
}

/**
 * "SINPE 8888 · transferencia BAC · también tarjeta" — one line joined with " · " is unreadable on WhatsApp
 * (agents2-format): a line with two or more " · " separators becomes a dash list (one item per line; a lead-in ending
 * in ":" stays as its own line). Same words, same order; a list is one unit, so shortening never drops an item.
 */
export function unjoinDotSeparated(text: string): string {
  return (text || '')
    .split('\n')
    .map((line) => {
      const pieces = line.split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean)
      if (pieces.length < 3) return line
      const colon = pieces[0].indexOf(':')
      const lead = colon >= 0 ? pieces[0].slice(0, colon + 1).trim() : ''
      if (colon >= 0) pieces[0] = pieces[0].slice(colon + 1).trim()
      const items = pieces.filter(Boolean).map((p) => `- ${p}`)
      return [lead, ...items].filter(Boolean).join('\n')
    })
    .join('\n')
}

const QUALIFYING_LINE_RE = /[₡¢$]|\d{3}|env[ií]o|(?<![\p{L}])(no|nunca|sin|solo|excepto)(?![\p{L}])|asistente\s+virtual|\[\[|\]\]|DATOS|PAGO/iu

/** Anything token-like left after code filled the payment tokens (never sent; a person looks). */
// Also single-bracket "[PAGO …]" / "[DATOS …]", "PAGO_SINPE" / "PAGO-SINPE" and the upper-case "DATOS PAGO" (SecureDog).
const LEFTOVER_TOKEN_RE = /\[\[|\]\]|[【】]|\[\s*(?:PAGO|DATOS)\b|PAGO[_-]\p{L}|DATOS_(?:DE_)?PAGO|DATOS[ -](?:DE[ -])?PAGO(?![\p{Ll}])/u
const LEFTOVER_TOKEN_STRIP_RE = /\[\[[^\]\n]{0,60}\]\]|【[^】\n]{0,60}】|\[\s*(?:PAGO|DATOS)[^\]\n]{0,40}\]|\[\[|\]\]|[【】]|(?<![\p{L}])(?:PAGO[_-][\p{L}_-]*|DATOS_(?:DE_)?PAGO|DATOS[ -](?:DE[ -])?PAGO)(?![\p{L}])/u

export type FinalOutputPolicy = {
  text: string
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  purchaseSummaryAppended: boolean
  highlightedAmounts: number[]
  intent: string
  /** The separate messages the text goes out as (splitReplyParts). */
  parts: string[]
  /** Payment tokens code filled ('all' = [[DATOS_PAGO]]); a filled contra-entrega token = an order ready for a person. */
  paymentMethods: Array<TokenPaymentMethod | 'all'>
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
  /**
   * INT-109 / INT-112: the text was written by the model (live turn / Probar, same runtime allowlist): any link not on
   * it is 'foreign_link'. Not given for the owner's own saved replies sent by code (inbound-decision).
   */
  linkAllowlist?: LinkAllowlist | null
  /** Sales flow: contra entrega offered by a shipping method (agent-sales-context) for [[PAGO_CONTRA_ENTREGA]]. */
  paymentOptions?: PaymentFillOptions
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
    // agents2-format: "a · b · c" on one line becomes one line per item (model text only; same words).
    const unjoined = unjoinDotSeparated(text)
    if (unjoined !== text) {
      text = unjoined
      reasons.push('unjoined')
    }
  }
  // Rafael 2026-10-16 (not negotiable): a shipping-data request goes out as the exact fixed list (after unjoining, so
  // a dot-joined request is caught too; before shortening, so the list is kept whole).
  const canonicalList = canonicalizeOrderDataList(text)
  if (canonicalList !== text) {
    text = canonicalList
    reasons.push('data_list')
  }
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
  // The length rule is judged with each token as its one line (a configured payment block is not "too long").
  let styleText = text
  const filled = fillPaymentToken(text, facts, input.paymentOptions)
  text = filled.text
  if (filled.needsHuman) reasons.push('payment_info_not_shared')
  // Any other [[…]] left (an unknown / invented token) is never sent: stripped, and a person looks (Verifier #4).
  // SecureDog INT-118a: also half tokens, 【…】 look-alikes and bare PAGO_ / DATOS_PAGO / DATOS_DE_PAGO words.
  if (LEFTOVER_TOKEN_RE.test(text)) {
    text = text
      .replace(new RegExp(LEFTOVER_TOKEN_STRIP_RE.source, 'gu'), '')
      .split('\n')
      .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
      .join('\n')
      .trim()
    styleText = styleText.replace(new RegExp(LEFTOVER_TOKEN_STRIP_RE.source, 'gu'), '')
    reasons.push('unknown_token')
  }
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
      styleText = `${styleText}\n${rendered}`.trim()
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
    // INT-109: live and Probar both come through here — a reply may only link the brand's own site.
    linkAllowlist: input.linkAllowlist ?? undefined,
    styleText,
    linkText: styleText,
    orderClosing:
      filled.methods.some((m) => m === 'contra_entrega' || m === 'efectivo') ||
      input.paymentOptions?.chosenMethod === 'contra_entrega' ||
      input.paymentOptions?.chosenMethod === 'efectivo',
  })

  const merged = [...new Set([...reasons, ...validated.reasons])]
  const blocking = merged.filter((reason) => reason !== 'purchase_summary_appended' && reason !== 'shortened' && reason !== 'unjoined' && reason !== 'data_list')
  return {
    text,
    ok: blocking.length === 0,
    needsHuman: blocking.length > 0,
    reasons: merged,
    purchaseSummaryAppended,
    highlightedAmounts: validated.highlightedAmounts || [],
    intent,
    // agents2-format: the messages this reply goes out as (split last, after every check ran on the whole text).
    parts: splitReplyParts(text),
    paymentMethods: filled.methods,
  }
}
