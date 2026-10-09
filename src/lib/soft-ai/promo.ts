/**
 * "Promoción activa" (Phase B1): a promotion the OWNER configures per agent — never one the model invents.
 * Code applies it: shipping methods it covers cost ₡0, items/categories get the special price, and only the deal
 * wording it enables passes the validator. Stored in ChatAgentSettings.salesRules.promo (no SQL). Pure.
 */

export type PromoSpecialPrice = { scope: 'item' | 'category'; ref: string; price: number }

export type AgentPromo = {
  active: boolean
  /** Optional ISO date (inclusive, Costa Rica day) after which the promo stops applying. */
  endsAt: string | null
  freeShipping: boolean
  /** Shipping method ids it covers; empty = every offered method (pickup is free anyway). */
  freeShippingMethodIds: string[]
  specialPrices: PromoSpecialPrice[]
  /** Highlight contra entrega as part of the promo (coverage still decided by shipping zones). */
  codHighlight: boolean
  /** Short line the agent may use ("¡Envío gratis a todo Costa Rica por tiempo limitado!"). Numbers are stripped. */
  headline: string | null
}

export const EMPTY_PROMO: AgentPromo = {
  active: false,
  endsAt: null,
  freeShipping: false,
  freeShippingMethodIds: [],
  specialPrices: [],
  codHighlight: false,
  headline: null,
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export function parsePromo(raw: unknown): AgentPromo {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const endsAt = str(r.endsAt, 10)
  return {
    active: r.active === true,
    endsAt: endsAt && /^\d{4}-\d{2}-\d{2}$/.test(endsAt) ? endsAt : null,
    freeShipping: r.freeShipping === true,
    freeShippingMethodIds: Array.isArray(r.freeShippingMethodIds)
      ? r.freeShippingMethodIds.filter((x): x is string => typeof x === 'string' && x.length <= 64).slice(0, 20)
      : [],
    specialPrices: (Array.isArray(r.specialPrices) ? r.specialPrices : [])
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
      .filter((x) => (x.scope === 'item' || x.scope === 'category') && typeof x.ref === 'string' && typeof x.price === 'number')
      .filter((x) => Number.isFinite(x.price as number) && (x.price as number) > 0 && (x.price as number) < 100_000_000)
      .slice(0, 10)
      .map((x) => ({ scope: x.scope as 'item' | 'category', ref: String(x.ref).slice(0, 120), price: Math.round(x.price as number) })),
    codHighlight: r.codHighlight === true,
    // Headline is shown to the model as data: no digits (prices only ever come from code).
    headline: str(r.headline, 200)?.replace(/\d[\d.,\s]*/g, '').replace(/₡/g, '').replace(/\s{2,}/g, ' ').trim() || null,
  }
}

/** Costa Rica calendar day (UTC-6, no DST). */
export function costaRicaDay(now = new Date()): string {
  return new Date(now.getTime() - 6 * 3_600_000).toISOString().slice(0, 10)
}

export function promoInEffect(promo: AgentPromo | null | undefined, now = new Date()): boolean {
  if (!promo?.active) return false
  if (promo.endsAt && costaRicaDay(now) > promo.endsAt) return false
  return promo.freeShipping || promo.specialPrices.length > 0 || promo.codHighlight || Boolean(promo.headline)
}

/** Deal wording the validator may let through because the owner's promo enables it. */
export type AllowedDeal = 'free_shipping' | 'special_price'

export function promoAllowedDeals(promo: AgentPromo | null | undefined, now = new Date()): AllowedDeal[] {
  if (!promoInEffect(promo, now)) return []
  const out: AllowedDeal[] = []
  if (promo!.freeShipping) out.push('free_shipping')
  if (promo!.specialPrices.length) out.push('special_price')
  return out
}
