/**
 * Output policy for every AI-originated text: model, shortcuts, handoffs, appends.
 * Monetary amounts must match an authorized provenance class.
 */

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

export type OutputValidationResult = {
  ok: boolean
  needsHuman: boolean
  reasons: string[]
  highlightedAmounts?: number[]
}

export type AuthorizedAmountSource = 'inventory' | 'shipping' | 'quote'

const MONEY_RE = /[₡$]\s?\d|\d[\d.,]*\s*(colones|crc|usd)/i
/** Deals the agent may never invent (fixed rule 12, INT-72): discounts, promos, free shipping, gifts, "te lo dejo en". */
const DEAL_RE =
  // No bare "gratis" / "%" (free pickup, "100% algodón" are fine); deal phrasing only.
  /(?<![\p{L}])(descuentos?|promoci[oó]n(es)? especial|oferta especial|precio especial|rebaj\p{L}*|env[ií]o (gratis|sin costo|de regalo|por la casa)|te (lo|la|los|las) (dejo|rebajo|regalo)|te regalo|de regalo|por la casa|sin cobrarte|te hago (un )?precio|2x1|3x2|\d{1,2}\s?%\s*(de\s+)?(descuento|off|menos))(?![\p{L}])/iu
const DEAL_ALL_RE = new RegExp(DEAL_RE.source, 'giu')
const FREE_SHIPPING_DEAL_RE = /^env[ií]o (gratis|sin costo)$/iu
const SPECIAL_PRICE_DEAL_RE = /^(precio especial|promoci[oó]n(es)? especial|oferta especial)$/iu

/**
 * Deal wording is blocked unless the owner's active promo enables that exact kind (B1): free shipping and a special
 * price can be enabled; discounts, %, 2x1, "te lo dejo en", gifts are always blocked.
 */
export function dealProblem(text: string, allowed: ReadonlyArray<'free_shipping' | 'special_price'>): boolean {
  for (const m of text.matchAll(DEAL_ALL_RE)) {
    const phrase = m[1].trim()
    if (allowed.includes('free_shipping') && FREE_SHIPPING_DEAL_RE.test(phrase)) continue
    if (allowed.includes('special_price') && SPECIAL_PRICE_DEAL_RE.test(phrase)) continue
    return true
  }
  return false
}

const CREATED_CLAIM_RE = /ya\s+(cre[eé]|registr[eé]|arm[eé])|pedido\s+creado|acabo\s+de\s+crear/i
const UNIT_COST_RE = /unitCost|costo\s+unitario|precio\s+de\s+costo/i
const SHIP_CUE_RE = /env[ií]o|retiro|domicilio|\bGAM\b|correos|mensajer/i
const PAY_CUE_RE = /\b(pago|sinpe|transferencia|tarjeta|efectivo|contra\s*entrega)\b/i
const PURCHASE_INTENTS = new Set<AgentIntent>(['price', 'how_to_buy'])

export function extractMoneyAmounts(text: string): number[] {
  const matches = text.matchAll(/[₡$]\s?(\d(?:[\d.\s]*\d)?)|\b(\d[\d.,]*)\s*(?:colones|crc|usd)\b/gi)
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
}): OutputValidationResult {
  const reasons: string[] = []
  const text = input.text || ''
  const cited = new Set(input.citedToolNames)
  const highlighted: number[] = []

  if (UNIT_COST_RE.test(text)) reasons.push('unit_cost_leak')
  if (CREATED_CLAIM_RE.test(text)) reasons.push('write_claim')
  if (dealProblem(text, input.allowedDeals ?? [])) reasons.push('deal_offer')
  if (hasConfirmationWording(text)) reasons.push('confirmation_wording')

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
}): FinalOutputPolicy {
  const facts = input.brandFacts || { schemaVersion: 1 }
  const style = input.replyStyle || DEFAULT_REPLY_STYLE
  const intent = (input.intent || 'other') as AgentIntent
  const shippingAmounts = input.freeShipping ? [] : shippingProvenanceAmounts(facts)
  let text = (input.text || '').trim()
  let purchaseSummaryAppended = false
  const reasons: string[] = []
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
  })

  const merged = [...new Set([...reasons, ...validated.reasons])]
  const blocking = merged.filter((reason) => reason !== 'purchase_summary_appended')
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
