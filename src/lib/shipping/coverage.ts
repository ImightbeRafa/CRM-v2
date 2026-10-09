/**
 * Where a shipping method delivers and where it accepts contra entrega (SQL 053 "ShippingMethodCoverage").
 * Pure rules (no DB) so the AI tools, the order gate and tests share one answer. Places are normalized
 * "provincia" | "provincia|canton" | "provincia|canton|distrito"; a broader place covers everything inside it.
 * 'gam' reuses the production Correos GAM classifier (correos-gam-pricing), never a second copy.
 */
import { getCorreosAutomatedShippingCost, normalizeCostaRicaLocation } from '@/lib/correos-gam-pricing'

export type CoverageMode = 'all' | 'gam' | 'list'
export type MethodCoverage = {
  shippingMethodId: string
  coverage: CoverageMode
  places: string[]
  allowsCod: boolean
  codCoverage: 'same' | 'gam' | 'list'
  codPlaces: string[]
}
export type Place = { province?: string | null; canton?: string | null; district?: string | null }
/** true / false, or null when the address is not complete enough to know (ask the customer, never guess). */
export type CoverageAnswer = { covered: boolean | null; cod: boolean | null; reason: string }

export const DEFAULT_COVERAGE = (shippingMethodId: string): MethodCoverage => ({
  shippingMethodId,
  coverage: 'all',
  places: [],
  allowsCod: false,
  codCoverage: 'same',
  codPlaces: [],
})

export function placeKey(p: Place): string {
  return [p.province, p.canton, p.district]
    .map((x) => normalizeCostaRicaLocation(x))
    .filter(Boolean)
    .join('|')
}

/** Normalize owner-entered places ("San José | Escazú") and drop junk; max 500. */
export function normalizePlaces(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const parts = v.split('|').map((x) => normalizeCostaRicaLocation(x)).filter(Boolean).slice(0, 3)
    if (parts.length && parts.every((x) => x.length <= 60)) out.add(parts.join('|'))
    if (out.size >= 500) break
  }
  return [...out]
}

function inList(list: string[], p: Place): boolean | null {
  const prov = normalizeCostaRicaLocation(p.province)
  const cant = normalizeCostaRicaLocation(p.canton)
  const dist = normalizeCostaRicaLocation(p.district)
  if (!prov) return null
  const keys = [prov, cant && `${prov}|${cant}`, cant && dist && `${prov}|${cant}|${dist}`].filter(Boolean) as string[]
  if (keys.some((k) => list.includes(k))) return true
  // A listed canton/district deeper than what we know → we cannot answer yet.
  const deeper = list.some((k) => k.startsWith(`${keys[keys.length - 1]}|`))
  return deeper ? null : false
}

function inGam(p: Place): boolean | null {
  const r = getCorreosAutomatedShippingCost(p)
  return r.zone === 'gam' ? true : r.zone === 'outside_gam' ? false : null
}

function check(mode: CoverageMode, list: string[], p: Place): boolean | null {
  if (mode === 'all') return true
  if (mode === 'gam') return inGam(p)
  return inList(list, p)
}

export function coverageFor(rule: MethodCoverage, p: Place): CoverageAnswer {
  const covered = check(rule.coverage, rule.places, p)
  if (covered === null) return { covered: null, cod: null, reason: 'Falta provincia, cantón o distrito para saber si llega' }
  if (!covered) return { covered: false, cod: false, reason: 'Este método no llega a esa zona' }
  if (!rule.allowsCod) return { covered: true, cod: false, reason: 'Este método no acepta contra entrega' }
  const cod = rule.codCoverage === 'same' ? true : check(rule.codCoverage, rule.codPlaces, p)
  if (cod === null) return { covered: true, cod: null, reason: 'Falta cantón o distrito para saber si aplica contra entrega' }
  return { covered: true, cod, reason: cod ? 'Llega y acepta contra entrega' : 'Llega, pero sin contra entrega en esa zona' }
}

export function parseCoverageRow(r: Record<string, unknown>): MethodCoverage {
  const mode = (v: unknown): CoverageMode => (v === 'gam' || v === 'list' ? v : 'all')
  return {
    shippingMethodId: String(r.shippingMethodId),
    coverage: mode(r.coverage),
    places: normalizePlaces(r.places),
    allowsCod: r.allowsCod === true,
    codCoverage: r.codCoverage === 'gam' || r.codCoverage === 'list' ? r.codCoverage : 'same',
    codPlaces: normalizePlaces(r.codPlaces),
  }
}
