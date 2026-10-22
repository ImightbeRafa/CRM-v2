/**
 * Betsy plan price: the one source of truth for what Betsy costs (Rafael, 2026-10-22: $20/month + IVA).
 * Used by the landing (/home), the billing docs (<PlanPrice/> in DocRenderer) and BillingDashboard.
 * Pure (no server-only): safe in client and server components.
 *
 * Display only. What Tilopay actually charges is set where the charge is created:
 *  - Monthly subscription (Tilopay Repeat plan): CRC 10,000 in src/app/api/tilopay/create-plan-repeat/route.ts.
 *    That is about $20 BEFORE IVA, so today's charge does not include the 13% IVA. Existing subscribers keep
 *    that charge; changing it is Rafael's call (see LEGACY_SUBSCRIPTION_CRC).
 * All money is integer cents so the IVA math never drifts.
 */

/** Costa Rica IVA on digital services: 13%, in basis points. */
export const IVA_BPS = 1300

export const BETSY_PLAN = {
  name: 'Betsy',
  /** Price before IVA, in US cents. */
  baseUsdCents: 2000,
  interval: 'month',
  trialDays: 7,
} as const

/**
 * What the Tilopay Repeat subscription charges today (CRC, no IVA). Kept as-is for existing subscribers.
 * Decision for Rafael: $20 + IVA = $22.60 ≈ CRC 11,300 at ~500 CRC/USD; the plan still charges CRC 10,000.
 */
export const LEGACY_SUBSCRIPTION_CRC = 10_000

/** IVA on an amount in cents, rounded half-up to the cent. */
export function ivaCents(baseCents: number, ivaBps: number = IVA_BPS): number {
  return Math.round((Math.max(0, Math.round(baseCents)) * ivaBps) / 10_000)
}

export type PlanPriceBreakdown = { baseCents: number; ivaCents: number; totalCents: number; ivaPercent: number }

export function planPriceBreakdown(baseCents: number = BETSY_PLAN.baseUsdCents, ivaBps: number = IVA_BPS): PlanPriceBreakdown {
  const base = Math.max(0, Math.round(baseCents))
  const iva = ivaCents(base, ivaBps)
  return { baseCents: base, ivaCents: iva, totalCents: base + iva, ivaPercent: ivaBps / 100 }
}

/** `2000` → `$20`, `2260` → `$22.60` (whole dollars drop the cents). */
export function formatUsdCents(cents: number): string {
  const n = Math.round(cents)
  const whole = n % 100 === 0
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** Ready-made strings for the landing, docs and billing screens. */
export function planPriceLabels(breakdown: PlanPriceBreakdown = planPriceBreakdown()) {
  return {
    base: formatUsdCents(breakdown.baseCents),
    iva: formatUsdCents(breakdown.ivaCents),
    total: formatUsdCents(breakdown.totalCents),
    ivaPercent: `${breakdown.ivaPercent}%`,
    /** "$20/mes + IVA" */
    short: `${formatUsdCents(breakdown.baseCents)}/mes + IVA`,
    /** "$20 + IVA (13%) = $22.60 al mes" */
    math: `${formatUsdCents(breakdown.baseCents)} + IVA (${breakdown.ivaPercent}%) = ${formatUsdCents(breakdown.totalCents)} al mes`,
  }
}
