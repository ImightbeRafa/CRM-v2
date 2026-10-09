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

import { stripBetsyLookalikes } from '@/lib/soft-ai/sales-state'

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
      .filter((x) => (x.scope === 'item' || x.scope === 'category') && typeof x.ref === 'string' && x.ref.trim().length > 0 && typeof x.price === 'number')
      .filter((x) => Number.isFinite(x.price as number) && (x.price as number) > 0 && (x.price as number) < 100_000_000)
      .slice(0, 10)
      .map((x) => ({ scope: x.scope as 'item' | 'category', ref: String(x.ref).trim().slice(0, 120), price: Math.round(x.price as number) })),
    codHighlight: r.codHighlight === true,
    headline: sanitizePromoHeadline(r.headline),
  }
}

/**
 * Headline is shown to the model as data (INT-77): NFKC first (so ①④⑨ / １４９ become digits), then no numbers of any
 * script, no ₡, no quotes / brackets / markers that could close the data fence or fake a Betsy line, one line.
 */
export function sanitizePromoHeadline(raw: unknown): string | null {
  const base = str(raw, 200)
  if (!base) return null
  const clean = stripBetsyLookalikes(base.normalize('NFKC'))
    .replace(/[₡$]?\s?\p{N}[\p{N}.,]*\s?%?/gu, '')
    .replace(/[₡$%]/g, '')
    .replace(/["“”„«»'‘’`<>{}\[\]]/g, '')
    .replace(/promoci[oó]n\s+activa|dato\s+de\s+betsy|texto\s+del\s+cliente/giu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || null
}

/** Amounts / deals written in words ("catorce mil", "dos por uno", "mitad de precio") are refused on save. */
const NUMBER_WORD_RE =
  /(?<![\p{L}])(cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis\p{L}+|veinti?\p{L}*|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|quinientos|mil|mill[oó]n\p{L}*|mitad|medio\s+precio|por\s+ciento)(?![\p{L}])/iu
export function headlineHasNumberWords(headline: string): boolean {
  return NUMBER_WORD_RE.test(headline)
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
