/**
 * Per-agent inventory map (server): which products an agent may quote. SQL 046; fail-safe when the table is
 * missing. No rows = today's behavior (whole active catalog). With rows, `search_inventory` only finds those.
 * Every query is scoped by tenantId and every item id is checked to belong to that tenant before it is stored.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'

export const MAX_MAPPED_ITEMS = 200
const TABLE = 'ChatAgentInventoryItem'

export class InventoryMapEmptyError extends Error {
  constructor() {
    super('INVENTORY_MAP_EMPTY')
    this.name = 'InventoryMapEmptyError'
  }
}

export class InventoryMapNotReadyError extends Error {
  constructor() {
    super('INVENTORY_MAP_NOT_READY')
    this.name = 'InventoryMapNotReadyError'
  }
}

/** null = the map is not available yet (SQL 046): callers behave as before. [] = available, nothing mapped. */
export async function loadMappedInventoryIds(tenantId: string, agentId: string): Promise<string[] | null> {
  if (!(await isTableReady(TABLE))) return null
  try {
    const rows = await prisma.$queryRaw<Array<{ inventoryItemId: string }>>`
      SELECT "inventoryItemId" FROM "ChatAgentInventoryItem"
       WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}
       LIMIT ${MAX_MAPPED_ITEMS}`
    return rows.map((r) => r.inventoryItemId)
  } catch (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
}

export async function listMappedInventory(tenantId: string, agentId: string) {
  const ids = await loadMappedInventoryIds(tenantId, agentId)
  if (ids === null) return { available: false as const, items: [] }
  if (ids.length === 0) return { available: true as const, items: [] }
  const items = await prisma.inventoryItem.findMany({
    where: { tenantId, id: { in: ids } },
    select: { id: true, name: true, sku: true, sellingPrice: true, currentStock: true, isActive: true },
    orderBy: { name: 'asc' },
  })
  return {
    available: true as const,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      sku: i.sku,
      sellingPrice: Number(i.sellingPrice),
      currentStock: Number(i.currentStock),
      isActive: i.isActive,
    })),
  }
}

/** Replaces the agent's map. Returns the number stored; ids of other businesses are ignored. */
export async function setMappedInventory(input: {
  tenantId: string
  agentId: string
  itemIds: string[]
  actorUserId: string
  /** Live agents with the product search on must keep at least one (checked AFTER tenant validation). */
  requireNonEmpty?: boolean
}): Promise<number> {
  if (!(await isTableReady(TABLE))) throw new InventoryMapNotReadyError()
  const wanted = [...new Set(input.itemIds.filter((id) => typeof id === 'string' && id && id.length <= 80))].slice(
    0,
    MAX_MAPPED_ITEMS,
  )
  const valid = wanted.length
    ? await prisma.inventoryItem.findMany({
        where: { tenantId: input.tenantId, id: { in: wanted } },
        select: { id: true },
      })
    : []
  const ids = valid.map((v) => v.id)
  if (input.requireNonEmpty && ids.length === 0) throw new InventoryMapEmptyError()
  await prisma.$transaction([
    // Two admins saving at once queue up instead of merging their lists.
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.agentId}))`,
    prisma.$executeRaw`
      DELETE FROM "ChatAgentInventoryItem" WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${input.agentId}`,
    ...(ids.length
      ? [
          prisma.$executeRaw`
            INSERT INTO "ChatAgentInventoryItem" ("id", "tenantId", "agentId", "inventoryItemId", "createdBy")
            SELECT gen_random_uuid()::text, ${input.tenantId}, ${input.agentId}, x, ${input.actorUserId}
              FROM unnest(${ids}::text[]) AS x
            ON CONFLICT ("agentId", "inventoryItemId") DO NOTHING`,
        ]
      : []),
  ])
  return ids.length
}

/** Used by the live gate: true when the map exists and has at least one product. */
export async function agentHasInventoryMap(tenantId: string, agentId: string): Promise<boolean | null> {
  const ids = await loadMappedInventoryIds(tenantId, agentId)
  return ids === null ? null : ids.length > 0
}
