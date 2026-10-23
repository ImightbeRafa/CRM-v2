/**
 * Display-only: exact product names for order lines.
 *
 * A productDetails item may carry `inventoryItemId` (staff bot, and Ventas / inbox prefill since lane J) while
 * its `type` holds a generic word ("Parche"). When the item has no saved `itemName`, the CURRENT inventory name
 * of that id (same business only) is added as `itemName`, so lists show "Parche Sleep · 30 u" instead of
 * "Parche". A saved `itemName` wins: renaming a product later does not rewrite old orders.
 *
 * Never changes `type` / `sku` / `product`: those drive stock matching (order-lifecycle extractInventoryRequests,
 * the legacy deduction in /api/orders, retiro stock), which this file must not influence.
 */
import 'server-only'
import { prisma } from '@/lib/db'

type WithDetails = { productDetails?: unknown }

const MAX_LOOKUP_IDS = 2_000

function parseItems(raw: unknown): Record<string, unknown>[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : null
  try {
    let parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null
  } catch {
    return null
  }
}

function needsName(item: unknown): item is Record<string, unknown> & { inventoryItemId: string } {
  if (!item || typeof item !== 'object') return false
  const rec = item as Record<string, unknown>
  const hasName = typeof rec.itemName === 'string' && rec.itemName.trim() !== ''
  return !hasName && typeof rec.inventoryItemId === 'string' && rec.inventoryItemId.length > 0 && rec.inventoryItemId.length <= 64
}

/** Pure: inventory ids that still need a name, across rows. */
export function inventoryIdsNeedingNames(rows: readonly WithDetails[]): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    for (const item of parseItems(row.productDetails) ?? []) {
      if (needsName(item)) ids.add(item.inventoryItemId)
    }
  }
  return [...ids].slice(0, MAX_LOOKUP_IDS)
}

/** Pure: rows with `itemName` filled from the given id → name map (productDetails stays a string when it was one). */
export function applyItemNames<T extends WithDetails>(rows: readonly T[], names: ReadonlyMap<string, string>): T[] {
  if (names.size === 0) return [...rows]
  return rows.map((row) => {
    const items = parseItems(row.productDetails)
    if (!items || !items.some((item) => needsName(item) && names.has(item.inventoryItemId))) return row
    const next = items.map((item) => (needsName(item) && names.has(item.inventoryItemId) ? { ...item, itemName: names.get(item.inventoryItemId) } : item))
    return { ...row, productDetails: typeof row.productDetails === 'string' ? JSON.stringify(next) : next }
  })
}

/** Logística (several businesses): each row only ever gets names from its own business's inventory. */
export async function withInventoryItemNamesByTenant<T extends WithDetails & { id: string; tenantId: string }>(rows: readonly T[]): Promise<T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const list = groups.get(row.tenantId) ?? []
    list.push(row)
    groups.set(row.tenantId, list)
  }
  const named = new Map<string, T>()
  await Promise.all(
    [...groups].map(async ([tenantId, group]) => {
      for (const row of await withInventoryItemNames(tenantId, group)) named.set(row.id, row)
    }),
  )
  return rows.map((row) => named.get(row.id) ?? row)
}

/** Adds current inventory names (same tenant only) to detail items that only have an inventoryItemId. */
export async function withInventoryItemNames<T extends WithDetails>(tenantId: string, rows: readonly T[]): Promise<T[]> {
  const ids = inventoryIdsNeedingNames(rows)
  if (!tenantId || ids.length === 0) return [...rows]
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true },
    })
    return applyItemNames(rows, new Map(items.map((i) => [i.id, i.name])))
  } catch (error) {
    console.warn('[item-names] lookup failed', (error as Error)?.message)
    return [...rows]
  }
}
