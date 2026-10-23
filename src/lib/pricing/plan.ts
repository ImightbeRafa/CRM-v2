/**
 * Betsy plan price: the one source of truth for what Betsy costs.
 * Rafael 2026-10-23: the price is what Tilopay actually charges, ₡10.000/mes (no Tilopay change for now).
 * Used by /home, /home-preview, the billing docs (<PlanPrice/> expanded in src/lib/docs.ts) and BillingDashboard.
 * Pure (no server-only): safe in client and server components.
 *
 * Display only. The charge itself is created in src/app/api/tilopay/create-plan-repeat/route.ts (CRC 10000);
 * keep the two equal (home-pricing.test.ts checks it).
 * IVA: Rafael confirmed (2026-10-23) that ₡10.000 already includes IVA, so every surface says "IVA incluido".
 * The flag also supports false ("+ IVA" with the 13% math) and null (say nothing) if that ever changes.
 */

/** Costa Rica IVA on digital services: 13%, in basis points (also used for AI credit packs). */
export const IVA_BPS = 1300

export const BETSY_PLAN: {
  name: string
  currency: 'CRC'
  /** Monthly price in colones (whole colones). */
  amountColones: number
  interval: 'month'
  trialDays: number
  /** Does `amountColones` include IVA? (Rafael 2026-10-23: yes.) */
  ivaIncluded: boolean | null
} = {
  name: 'Betsy',
  currency: 'CRC',
  amountColones: 10_000,
  interval: 'month',
  trialDays: 7,
  ivaIncluded: true,
}

/** What the Tilopay Repeat subscription charges (CRC). Same as the plan price. */
export const LEGACY_SUBSCRIPTION_CRC = BETSY_PLAN.amountColones

/** IVA on an amount in cents (or whole colones), rounded half-up. */
export function ivaCents(baseCents: number, ivaBps: number = IVA_BPS): number {
  return Math.round((Math.max(0, Math.round(baseCents)) * ivaBps) / 10_000)
}

/** `10000` → `₡10.000` (Costa Rica style: dot thousands, no decimals). */
export function formatColones(amount: number): string {
  const n = Math.max(0, Math.round(amount))
  return `₡${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** `2000` → `$20`, `2260` → `$22.60` (USD cents; AI credit packs are priced in dollars). */
export function formatUsdCents(cents: number): string {
  const n = Math.round(cents)
  const whole = n % 100 === 0
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** Ready-made strings for the landing, docs and billing screens. */
export function planPriceLabels(plan: Pick<typeof BETSY_PLAN, 'amountColones' | 'ivaIncluded'> = BETSY_PLAN, ivaBps: number = IVA_BPS) {
  const base = formatColones(plan.amountColones)
  const iva = ivaCents(plan.amountColones, ivaBps)
  const ivaPercent = `${ivaBps / 100}%`
  const ivaNote = plan.ivaIncluded === true ? 'IVA incluido' : plan.ivaIncluded === false ? '+ IVA' : ''
  return {
    /** "₡10.000" */
    base,
    ivaPercent,
    /** "IVA incluido" | "+ IVA" | "" (not confirmed) */
    ivaNote,
    /** IVA amount and total, only meaningful when IVA is charged on top. */
    iva: plan.ivaIncluded === false ? formatColones(iva) : null,
    total: plan.ivaIncluded === false ? formatColones(plan.amountColones + iva) : base,
    /** "₡10.000/mes" (+ " + IVA" / " (IVA incluido)") */
    short: `${base}/mes${plan.ivaIncluded === true ? ' (IVA incluido)' : plan.ivaIncluded === false ? ' + IVA' : ''}`,
    /** One sentence for docs: "₡10.000 al mes" / "₡10.000 al mes, IVA incluido" / "₡10.000 + IVA (13%) = ₡11.300 al mes" */
    math:
      plan.ivaIncluded === false
        ? `${base} + IVA (${ivaPercent}) = ${formatColones(plan.amountColones + iva)} al mes`
        : plan.ivaIncluded === true
          ? `${base} al mes, IVA incluido`
          : `${base} al mes`,
  }
}
