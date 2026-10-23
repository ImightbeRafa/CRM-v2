/**
 * Server reads of the short order number (`"Order"."orderNo"`, SQL 062).
 *
 * The column is deliberately not in schema.prisma (Prisma would name it in every
 * Order query and break before 062 is applied), so it is read here with raw SQL,
 * always scoped by tenantId. Deploy-order safe: until 062 is applied the column
 * is missing (Postgres 42703); we stop asking for a minute and every caller gets
 * "no number", so the UI shows the long orderId as before.
 *
 * Numbers are assigned by the database trigger at insert time, never here.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { normalizeOrderNo, parseOrderNoQuery } from '@/lib/orders/order-label'

const MISSING_COLUMN_RECHECK_MS = 60_000
const MAX_IDS = 5_000
let columnMissingUntil = 0

export function isMissingOrderNoColumn(error: unknown): boolean {
  const e = error as { code?: string; meta?: { code?: string }; message?: string }
  const code = String(e?.meta?.code || e?.code || '')
  const message = String(e?.message || '')
  return code === '42703' || code === '42P01' || (/orderNo/.test(message) && /does not exist/i.test(message))
}

async function guarded<T>(empty: T, run: () => Promise<T>): Promise<T> {
  if (Date.now() < columnMissingUntil) return empty
  try {
    return await run()
  } catch (error) {
    if (isMissingOrderNoColumn(error)) {
      columnMissingUntil = Date.now() + MISSING_COLUMN_RECHECK_MS // pre-062: stop asking for a minute
    } else {
      // Display-only data: a failed read must never fail the order list or a create response.
      console.warn('[order-number] read failed', (error as { code?: string })?.code || (error as Error)?.message)
    }
    return empty
  }
}

/** Test hook: forget the cached "column missing" state. */
export function resetOrderNoColumnCache(): void {
  columnMissingUntil = 0
}

/** Order.id → orderNo for the given orders of ONE tenant. Orders without a number are left out. */
export async function loadOrderNos(tenantId: string, orderIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(orderIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, MAX_IDS)
  const result = new Map<string, number>()
  if (!tenantId || ids.length === 0) return result
  const rows = await guarded<Array<{ id: string; orderNo: number | null }>>([], () =>
    prisma.$queryRaw<Array<{ id: string; orderNo: number | null }>>`
      SELECT "id", "orderNo" FROM "Order"
      WHERE "tenantId" = ${tenantId} AND "id" = ANY(${ids}::text[]) AND "orderNo" IS NOT NULL`,
  )
  for (const row of rows) {
    const no = normalizeOrderNo(row.orderNo)
    if (no !== null) result.set(row.id, no)
  }
  return result
}

/** Adds `orderNo` (number | null) to each row, keyed by the row's Order.id. */
export async function withOrderNos<T extends { id: string }>(
  tenantId: string,
  rows: readonly T[],
): Promise<Array<T & { orderNo: number | null }>> {
  const nos = await loadOrderNos(tenantId, rows.map((row) => row.id))
  return rows.map((row) => ({ ...row, orderNo: nos.get(row.id) ?? null }))
}

/** Same as withOrderNos for rows keyed by another field holding the Order.id (e.g. ChatMessage.orderId). */
export async function orderNosById(tenantId: string, orderIds: readonly (string | null | undefined)[]): Promise<Map<string, number>> {
  return loadOrderNos(tenantId, orderIds.filter((id): id is string => typeof id === 'string'))
}

/** Order.id of the tenant's order with this short number (archived ones included), or null. */
export async function findOrderIdByNo(tenantId: string, orderNo: number): Promise<string | null> {
  const no = normalizeOrderNo(orderNo)
  if (!tenantId || no === null) return null
  const rows = await guarded<Array<{ id: string }>>([], () =>
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "tenantId" = ${tenantId} AND "orderNo" = ${no} LIMIT 1`,
  )
  return rows[0]?.id ?? null
}

/**
 * Logística sees several businesses at once (the managed allowlist, already authorized by the caller): numbers
 * are per business, so rows are grouped by their own tenantId — never looked up under another tenant.
 */
export async function loadOrderNosByTenant(rows: ReadonlyArray<{ id: string; tenantId: string }>): Promise<Map<string, number>> {
  const byTenant = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.tenantId || !row.id) continue
    const list = byTenant.get(row.tenantId) ?? []
    list.push(row.id)
    byTenant.set(row.tenantId, list)
  }
  const maps = await Promise.all([...byTenant].map(([tenantId, ids]) => loadOrderNos(tenantId, ids)))
  const result = new Map<string, number>()
  for (const map of maps) for (const [id, no] of map) result.set(id, no)
  return result
}

/** Logística search: Order.ids with this short number in any of the given (authorized) businesses. */
export async function orderIdsForSearchInTenants(tenantIds: readonly string[], search: string | null | undefined): Promise<string[]> {
  const no = parseOrderNoQuery(search)
  const ids = [...new Set(tenantIds.filter(Boolean))]
  if (no === null || ids.length === 0) return []
  const rows = await guarded<Array<{ id: string }>>([], () =>
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Order" WHERE "tenantId" = ANY(${ids}::text[]) AND "orderNo" = ${no} LIMIT 50`,
  )
  return rows.map((r) => r.id)
}

/** For list searches: the Order.id whose short number matches "#1042" / "1042", or null. */
export async function orderIdForSearch(tenantId: string, search: string | null | undefined): Promise<string | null> {
  const no = parseOrderNoQuery(search)
  return no === null ? null : findOrderIdByNo(tenantId, no)
}

/** The short number of one order (by Order.id) right after it was created, or null. */
export async function loadOrderNo(tenantId: string, id: string): Promise<number | null> {
  const nos = await loadOrderNos(tenantId, [id])
  return nos.get(id) ?? null
}
