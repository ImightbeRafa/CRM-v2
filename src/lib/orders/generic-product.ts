/**
 * "Generic product name" on an order (lane J report). Pure.
 *
 * A line is generic when, ignoring counts like "1x" / "x2", its name is a known generic word ("parche",
 * "producto", the same list retiro stock uses) or one of the business's inventory CATEGORIES that is not also an
 * item name ("Parche" when the items are "Parche Sleep · 30 u", "Parche Focus"…). A line that carries an
 * `itemName` (exact item, lane J) is never generic.
 */
import { isGenericRetiroProductName, normalizeProductName } from '@/lib/retiro-stock-utils'

export type InventoryNames = { itemNames: ReadonlySet<string>; categories: ReadonlySet<string> }

export function inventoryNames(items: ReadonlyArray<{ name: string | null; category: string | null }>): InventoryNames {
  const itemNames = new Set<string>()
  const categories = new Set<string>()
  for (const item of items) {
    if (item.name) itemNames.add(normalizeProductName(item.name))
    if (item.category) categories.add(normalizeProductName(item.category))
  }
  return { itemNames, categories }
}

/** "1x Parche", "Parche x2", "2 Parche", "Parche (2)" → "parche". */
export function bareName(raw: string): string {
  return normalizeProductName(
    String(raw ?? '')
      .trim()
      .replace(/^\d{1,4}\s*[xX×]?\s+/, '')
      .replace(/\s*(?:[xX×]\s*\d{1,4}|\(\s*\d{1,4}\s*\))$/, ''),
  )
}

export function isGenericName(raw: string, inv: InventoryNames): boolean {
  const name = bareName(raw)
  if (!name) return false
  if (isGenericRetiroProductName(name)) return true
  return inv.categories.has(name) && !inv.itemNames.has(name)
}

function detailItems(raw: unknown): Record<string, unknown>[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    let parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? (parsed.filter((i) => i && typeof i === 'object') as Record<string, unknown>[]) : null
  } catch {
    return null
  }
}

function rawLength(raw: unknown): number {
  try {
    let parsed: unknown = JSON.parse(String(raw))
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? parsed.length : -1
  } catch {
    return -1
  }
}

/** Generic line names of one order ([] = every line names a specific product). */
export function genericLines(order: { product?: string | null; productDetails?: string | null }, inv: InventoryNames): string[] {
  const items = detailItems(order.productDetails)
  if (items && items.length > 0) {
    return items
      .filter((item) => !(typeof item.itemName === 'string' && item.itemName.trim()))
      .map((item) => String(item.type ?? item.name ?? item.product ?? '').trim())
      .filter((name) => name && isGenericName(name, inv))
  }
  return String(order.product ?? '')
    .split(/\r?\n|;|,/)
    .map((part) => part.trim())
    .filter((part) => part && isGenericName(part, inv))
}

/**
 * Safe itemName backfill for one order: only detail items with an inventoryItemId that resolves (same business)
 * and no itemName yet. Returns the new productDetails JSON, or null when there is nothing to fill.
 */
export function fillItemNames(productDetails: string | null | undefined, namesById: ReadonlyMap<string, string>): string | null {
  const items = detailItems(productDetails)
  if (!items) return null
  // Only rewrite well-formed arrays (every entry an object), so nothing but `itemName` ever changes.
  if (items.length !== rawLength(productDetails)) return null
  let changed = false
  const next = items.map((item) => {
    const id = typeof item.inventoryItemId === 'string' ? item.inventoryItemId : ''
    const has = typeof item.itemName === 'string' && item.itemName.trim() !== ''
    const name = id ? namesById.get(id) : undefined
    if (has || !name) return item
    changed = true
    return { ...item, itemName: name }
  })
  return changed ? JSON.stringify(next) : null
}
