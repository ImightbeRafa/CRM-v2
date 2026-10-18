/**
 * Out-of-stock switch (server, SQL 055). One row per product of a store (tenantId + inventoryItemId): the owner's
 * "Agotado" + optional "vuelve aprox." date or note. Every query is scoped by tenantId; a missing table (SQL not
 * applied yet) means "no rows" — the agent behaves exactly as before (sold out only at stock 0).
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { buildStockGuard, sanitizeBackNote, type AvailabilityRow } from '@/lib/soft-ai/product-availability-core'

const TABLE = 'InventoryItemAvailability'

export class AvailabilityNotReadyError extends Error {
  constructor() {
    super('AVAILABILITY_NOT_READY')
    this.name = 'AvailabilityNotReadyError'
  }
}

export async function availabilityReady(): Promise<boolean> {
  return isTableReady(TABLE)
}

/** Rows for these products of this tenant (only rows that say something). Empty map when the table is missing. */
export async function loadAvailability(tenantId: string, itemIds: string[]): Promise<Map<string, AvailabilityRow>> {
  const out = new Map<string, AvailabilityRow>()
  const ids = [...new Set(itemIds)].filter(Boolean).slice(0, 400)
  if (ids.length === 0 || !(await isTableReady(TABLE))) return out
  try {
    const rows = await prisma.$queryRaw<Array<{ inventoryItemId: string; soldOut: boolean; backDate: string | null; backNote: string | null }>>`
      SELECT "inventoryItemId", "soldOut", to_char("backDate", 'YYYY-MM-DD') AS "backDate", "backNote"
        FROM "InventoryItemAvailability"
       WHERE "tenantId" = ${tenantId} AND "inventoryItemId" = ANY(${ids}::text[])`
    for (const r of rows) {
      out.set(r.inventoryItemId, { soldOut: r.soldOut === true, backDate: r.backDate, backNote: sanitizeBackNote(r.backNote) })
    }
  } catch (error) {
    if (isMissingRelation(error)) return out
    throw error
  }
  return out
}

/** Upsert one product's switch. The caller already checked the item belongs to the tenant (and the agent). */
export async function saveAvailability(input: {
  tenantId: string
  inventoryItemId: string
  soldOut: boolean
  backDate: string | null
  backNote: string | null
  actorUserId: string
}): Promise<AvailabilityRow | null> {
  if (!(await isTableReady(TABLE))) throw new AvailabilityNotReadyError()
  // The "vuelve aprox." is kept as sent (it also serves a product sold out by stock 0, without the manual switch);
  // the screen sends it empty when the owner switches "Agotado" off. Only shown while the product is sold out.
  const backDate = input.backDate
  const backNote = backDate ? null : sanitizeBackNote(input.backNote)
  const before = (await loadAvailability(input.tenantId, [input.inventoryItemId])).get(input.inventoryItemId) ?? null
  await prisma.$executeRaw`
    INSERT INTO "InventoryItemAvailability" ("id", "tenantId", "inventoryItemId", "soldOut", "backDate", "backNote", "updatedBy", "updatedAt")
    VALUES (gen_random_uuid()::text, ${input.tenantId}, ${input.inventoryItemId}, ${input.soldOut}, ${backDate}::date, ${backNote}, ${input.actorUserId}, now())
    ON CONFLICT ("tenantId", "inventoryItemId") DO UPDATE
       SET "soldOut" = EXCLUDED."soldOut", "backDate" = EXCLUDED."backDate", "backNote" = EXCLUDED."backNote",
           "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now()`
  return before
}

/** Loads the agent's products + switches and builds the guard (live turn, Probar, search_inventory). */
export async function loadAgentStock(tenantId: string, itemIds: string[]) {
  const ids = [...new Set(itemIds)].filter(Boolean).slice(0, 400)
  if (ids.length === 0) return buildStockGuard([], new Map())
  const [items, rows] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { tenantId, isActive: true, id: { in: ids } },
      select: { id: true, name: true, currentStock: true, isActive: true },
    }),
    loadAvailability(tenantId, ids),
  ])
  return buildStockGuard(items, rows)
}
