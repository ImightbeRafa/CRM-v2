/**
 * AI credits: every money rule in one pure module (no DB, no server-only), shared by the routes, the usage page,
 * the owner settings and the allowance Lane D plugs into the inbox agent.
 *
 * Units: integer USD micros (1 USD = 1,000,000).
 *  - list cost   = AiUsageEvent.costMicros (model price card, src/lib/ai-usage/rate-card.ts)
 *  - billed      = list cost × markup, BEFORE IVA. Credits, balance, free credit and limits are all billed micros.
 *  - IVA (13%)   is charged once, on the Tilopay amount when a credit pack is bought (never again on usage).
 * Rounding: billed = ceil(Σ list cost of the month × markup) on the month total (not per event), so the sum
 * never drifts; pack prices are whole cents and IVA rounds half-up to the cent (src/lib/pricing/plan.ts).
 */
import { IVA_BPS, ivaCents } from '@/lib/pricing/plan'

export const MICROS_PER_USD = 1_000_000
export const MICROS_PER_CENT = 10_000

/** Defaults until the owner saves a rate (Rafael 2026-10-22: markup still open → ×2; "a few" free credits → $1). */
export const DEFAULT_RATE: AiBillingRate = { periodKey: '2026-01', markupBps: 20_000, freeMonthlyMicros: 1 * MICROS_PER_USD }
export const MIN_MARKUP_BPS = 10_000
export const MAX_MARKUP_BPS = 100_000
export const MAX_FREE_MICROS = 1_000 * MICROS_PER_USD
export const MAX_LIMIT_MICROS = 100_000 * MICROS_PER_USD

export type AiBillingRate = { periodKey: string; markupBps: number; freeMonthlyMicros: number }

export type CreditPack = { id: string; creditCents: number }
export const DEFAULT_PACKS: CreditPack[] = [
  { id: 'p10', creditCents: 1_000 },
  { id: 'p25', creditCents: 2_500 },
  { id: 'p50', creditCents: 5_000 },
]
export const MAX_PACKS = 6
export const MIN_PACK_CENTS = 500
export const MAX_PACK_CENTS = 100_000

/**
 * Features a business pays for. Everything else is Betsy's own cost and shows as "incluido":
 * the staff bot (never gated), agent tests/exams and Probar (our build work), templates (Meta bills them).
 * Rafael may widen this (decision in the PR).
 */
export const BILLABLE_FEATURES = ['inbox_agent', 'payment_check', 'vision', 'customer_paste', 'agent_import', 'shortcut_import'] as const
export function isBillableFeature(feature: string): boolean {
  return (BILLABLE_FEATURES as readonly string[]).includes(feature)
}

const toInt = (n: unknown): number => {
  const v = Math.trunc(Number(n))
  return Number.isFinite(v) ? v : 0
}

/** billed = ceil(list × markup). BigInt so a large month can never lose precision. */
export function billedFromList(listMicros: number, markupBps: number): number {
  const list = BigInt(Math.max(0, toInt(listMicros)))
  const bps = BigInt(Math.max(MIN_MARKUP_BPS, toInt(markupBps)))
  return Number((list * bps + BigInt(9_999)) / BigInt(10_000))
}

/** Inverse for the inbox allowance (list micros the agent may still spend): floor, never over-grants. */
export function listFromBilled(billedMicros: number, markupBps: number): number {
  const billed = BigInt(Math.max(0, toInt(billedMicros)))
  const bps = BigInt(Math.max(MIN_MARKUP_BPS, toInt(markupBps)))
  return Number((billed * BigInt(10_000)) / bps)
}

/** "2026-10" → "2026-11". */
export function nextPeriodKey(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number)
  return m >= 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

export function isPeriodKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)
}

/** The rate that prices `periodKey`: the newest row starting on or before it, else the default. */
export function rateForPeriod(rows: AiBillingRate[], periodKey: string): AiBillingRate {
  let best: AiBillingRate | null = null
  for (const r of rows) if (r.periodKey <= periodKey && (!best || r.periodKey > best.periodKey)) best = r
  return best ?? DEFAULT_RATE
}

/** Server-side pack quote: what Tilopay charges (pack + IVA) and what the business gets (pack, pre-IVA). */
export function quotePack(pack: CreditPack, ivaBps: number = IVA_BPS) {
  const priceCents = Math.max(0, toInt(pack.creditCents))
  const iva = ivaCents(priceCents, ivaBps)
  return { packId: pack.id, priceCents, ivaCents: iva, totalCents: priceCents + iva, creditMicros: priceCents * MICROS_PER_CENT }
}

/** Validates the owner's pack list: unique ids, whole cents within bounds, at most MAX_PACKS. */
export function normalizePacks(raw: unknown): CreditPack[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PACKS) return null
  const out: CreditPack[] = []
  const ids = new Set<string>()
  for (const p of raw) {
    const id = typeof p?.id === 'string' ? p.id.trim() : ''
    const cents = Number(p?.creditCents)
    if (!/^[a-z0-9_-]{1,24}$/.test(id) || ids.has(id)) return null
    if (!Number.isInteger(cents) || cents < MIN_PACK_CENTS || cents > MAX_PACK_CENTS) return null
    ids.add(id)
    out.push({ id, creditCents: cents })
  }
  return out
}

/**
 * How much of a closed month's usage the balance pays for. The free credit covers usage first; the rest is taken
 * from the prepaid balance, never below zero (a few cents over the soft cap are on Betsy, never a debt).
 */
export function settleAmount(input: { billedMicros: number; freeMicros: number; balanceBeforeMicros: number }) {
  const overage = Math.max(0, toInt(input.billedMicros) - Math.max(0, toInt(input.freeMicros)))
  const taken = Math.min(overage, Math.max(0, toInt(input.balanceBeforeMicros)))
  return { overageMicros: overage, amountMicros: -taken, forgivenMicros: overage - taken }
}

export type CreditDecision = {
  /** free credit + prepaid balance available this month (billed micros). */
  creditMicros: number
  /** The business's own limit clamped to the owner's ceiling, or null. */
  limitMicros: number | null
  billedMicros: number
  /** Before the tighter of credit / limit runs out. */
  remainingMicros: number
  /** Which cap is tighter right now. */
  cap: 'credit' | 'limit'
  /** % of the tighter cap used (0–100+). */
  usedPct: number
  /** Banner level for the usage page: 80 % or 100 % of the tighter cap. */
  alert: 0 | 80 | 100
  /** Only true when enforcement is on, the business is not exempt and a cap is reached: the AI pauses. */
  exhausted: boolean
  enforced: boolean
}

export function effectiveLimit(limitMicros: number | null, ceilingMicros: number | null): number | null {
  const l = limitMicros && limitMicros > 0 ? toInt(limitMicros) : null
  const c = ceilingMicros && ceilingMicros > 0 ? toInt(ceilingMicros) : null
  if (l === null) return c
  if (c === null) return l
  return Math.min(l, c)
}

export function decideCredits(input: {
  billedMicros: number
  freeMicros: number
  balanceMicros: number
  limitMicros: number | null
  ceilingMicros: number | null
  enforce: boolean
  exempt: boolean
}): CreditDecision {
  const billed = Math.max(0, toInt(input.billedMicros))
  const credit = Math.max(0, toInt(input.freeMicros)) + Math.max(0, toInt(input.balanceMicros))
  const limit = effectiveLimit(input.limitMicros, input.ceilingMicros)
  const cap: 'credit' | 'limit' = limit !== null && limit < credit ? 'limit' : 'credit'
  const capMicros = cap === 'limit' ? (limit as number) : credit
  const remaining = capMicros - billed
  const usedPct = capMicros > 0 ? Math.round((billed / capMicros) * 1000) / 10 : billed > 0 ? 100 : 0
  const enforced = input.enforce && !input.exempt
  // A cap of $0 (no free credit, no balance) is "100 % used": the banner must explain any pause.
  const alert: 0 | 80 | 100 = usedPct >= 100 || remaining <= 0 ? 100 : usedPct >= 80 ? 80 : 0
  return {
    creditMicros: credit,
    limitMicros: limit,
    billedMicros: billed,
    remainingMicros: remaining,
    cap,
    usedPct,
    alert,
    exhausted: enforced && remaining <= 0,
    enforced,
  }
}

/** "$1.2345" style for micros: cents unless the amount is under one cent. */
export function formatUsdMicros(micros: number): string {
  const v = toInt(micros) / MICROS_PER_USD
  const abs = Math.abs(v)
  const digits = abs > 0 && abs < 0.01 ? 4 : 2
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

/** "×2" / "×1.5" for a markup in basis points. */
export function formatMarkup(markupBps: number): string {
  return `×${(toInt(markupBps) / 10_000).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/**
 * Pure webhook rule for a credit-pack payment (store.applyPurchaseWebhook runs it, then writes with
 * status-guarded UPDATE + UNIQUE ledger key so a replay or a race can never credit twice).
 */
export type PurchaseWebhookAction = 'credit' | 'already_paid' | 'unknown_ref' | 'mismatch' | 'mark_failed' | 'refund' | 'ignore'
export function decidePurchaseWebhook(input: {
  purchase: { status: string; totalCents: number } | null
  approved: boolean
  declined: boolean
  /** Tilopay says the payment was refunded / voided / charged back. */
  refunded?: boolean
  amountCents: number
  currency: string
  transactionId: string | null
}): PurchaseWebhookAction {
  const p = input.purchase
  if (!p) return 'unknown_ref'
  if (input.refunded) return p.status === 'paid' ? 'refund' : 'ignore'
  if (p.status === 'refunded') return 'ignore'
  if (p.status === 'paid') return 'already_paid'
  if (input.declined) return p.status === 'pending' ? 'mark_failed' : 'ignore'
  if (!input.approved) return 'ignore'
  if (!input.transactionId) return 'mismatch'
  if (input.currency.trim().toUpperCase() !== 'USD') return 'mismatch'
  if (!Number.isInteger(input.amountCents) || input.amountCents !== p.totalCents) return 'mismatch'
  return 'credit'
}

/**
 * Kill switch for selling credit packs: OFF unless AI_CREDIT_PACKS_ENABLED=true. The one-off payment-link path
 * (src/lib/tilopay.ts createPaymentLink, amounts in minor units) is not proven against Tilopay yet: one sandbox
 * charge must confirm the amount units and the webhook payload before it is turned on.
 */
export function creditPacksEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AI_CREDIT_PACKS_ENABLED === 'true' && creditPaymentsEnvAllowed(env)
}

/**
 * Credit payments only run in production: Railway preview shares the production database, so a preview webhook
 * (e.g. with a sandbox secret) must never credit the real ledger. APP_ENV 'production' or unset in a production
 * build passes; 'preview' / 'development' / any other value fails closed.
 */
export function creditPaymentsEnvAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const appEnv = (env.APP_ENV || '').trim().toLowerCase()
  if (appEnv) return appEnv === 'production'
  return env.NODE_ENV === 'production'
}

/**
 * Businesses never capped (the owner's own): same env as soft-ai/ai-allowance.ts (AI_ALLOWANCE_EXEMPT_TENANTS).
 * Read here, not imported from soft-ai, so the allowance hook Lane D imports never forms an import cycle.
 */
export function aiExemptTenantIds(raw: string | undefined = process.env.AI_ALLOWANCE_EXEMPT_TENANTS): Set<string> {
  return new Set((raw || '').split(',').map((s) => s.trim()).filter(Boolean))
}
