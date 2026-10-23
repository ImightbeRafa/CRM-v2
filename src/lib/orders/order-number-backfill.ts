/**
 * Backfill of short order numbers (SQL 062) for orders created before the trigger existed.
 *
 * Rule: per business, the orders without a number get the smallest free positive numbers, in creation order
 * ("timestamp", id) — archived orders included, so a number is never reused for another order. Normally the
 * trigger left 1..N free for the N old orders, so they become #1..#N in the order they were created.
 * Idempotent: only rows with "orderNo" IS NULL are touched; a second run finds nothing to do.
 * Raw SQL on purpose: it does not bump "updatedAt" (Prisma's @updatedAt is client-side), so no order looks edited.
 *
 * Used by scripts/order-number-backfill.ts and the local Postgres test (scripts/test-order-number-pg.ts).
 */
import type { Sql } from 'postgres'

export type OrderNoAssignment = { id: string; orderNo: number }

/** Pure: smallest free positive numbers, in the given (creation) order. */
export function planOrderNumbers(taken: readonly number[], idsInCreationOrder: readonly string[]): OrderNoAssignment[] {
  const used = new Set(taken.filter((n) => Number.isInteger(n) && n > 0))
  const plan: OrderNoAssignment[] = []
  let next = 1
  for (const id of idsInCreationOrder) {
    while (used.has(next)) next += 1
    plan.push({ id, orderNo: next })
    used.add(next)
    next += 1
  }
  return plan
}

export type TenantBackfillResult = {
  tenantId: string
  missing: number
  firstNo: number | null
  lastNo: number | null
  counterBefore: number | null
  counterAfter: number | null
  applied: boolean
}

const BATCH = 500

/**
 * One business. Dry run = read-only. Apply = one transaction that locks the counter row first, so orders created
 * meanwhile wait (briefly) and then continue after the highest number.
 */
export async function backfillTenantOrderNumbers(sql: Sql, tenantId: string, apply: boolean): Promise<TenantBackfillResult> {
  const run = async (tx: Sql) => {
    if (apply) {
      // Lock (creating it if needed) the counter row: the trigger UPDATEs it on every insert.
      await tx`INSERT INTO "OrderNumberCounter" ("tenantId", "lastNo") VALUES (${tenantId}, 0) ON CONFLICT ("tenantId") DO NOTHING`
    }
    const counterRows = apply
      ? await tx<{ lastNo: number }[]>`SELECT "lastNo" FROM "OrderNumberCounter" WHERE "tenantId" = ${tenantId} FOR UPDATE`
      : await tx<{ lastNo: number }[]>`SELECT "lastNo" FROM "OrderNumberCounter" WHERE "tenantId" = ${tenantId}`
    const counterBefore = counterRows[0] ? Number(counterRows[0].lastNo) : null
    const takenRows = await tx<{ orderNo: number }[]>`
      SELECT "orderNo" FROM "Order" WHERE "tenantId" = ${tenantId} AND "orderNo" IS NOT NULL`
    const missingRows = await tx<{ id: string }[]>`
      SELECT "id" FROM "Order" WHERE "tenantId" = ${tenantId} AND "orderNo" IS NULL ORDER BY "timestamp" ASC, "id" ASC`
    const plan = planOrderNumbers(takenRows.map((r) => Number(r.orderNo)), missingRows.map((r) => r.id))
    const maxTaken = takenRows.reduce((m, r) => Math.max(m, Number(r.orderNo)), 0)
    const maxPlanned = plan.reduce((m, p) => Math.max(m, p.orderNo), 0)
    let counterAfter = counterBefore
    if (apply && plan.length > 0) {
      for (let i = 0; i < plan.length; i += BATCH) {
        const chunk = plan.slice(i, i + BATCH)
        await tx`
          UPDATE "Order" AS o SET "orderNo" = v.no
          FROM (SELECT unnest(${chunk.map((p) => p.id)}::text[]) AS id, unnest(${chunk.map((p) => p.orderNo)}::int[]) AS no) AS v
          WHERE o."id" = v.id AND o."tenantId" = ${tenantId} AND o."orderNo" IS NULL`
      }
    }
    if (apply) {
      const top = Math.max(counterBefore ?? 0, maxTaken, maxPlanned)
      await tx`UPDATE "OrderNumberCounter" SET "lastNo" = ${top}, "updatedAt" = CURRENT_TIMESTAMP WHERE "tenantId" = ${tenantId}`
      counterAfter = top
    }
    return {
      tenantId,
      missing: plan.length,
      firstNo: plan.length ? plan[0].orderNo : null,
      lastNo: plan.length ? plan[plan.length - 1].orderNo : null,
      counterBefore,
      counterAfter,
      applied: apply && plan.length > 0,
    }
  }
  if (!apply) return run(sql)
  return sql.begin((tx) => run(tx as unknown as Sql)) as Promise<TenantBackfillResult>
}

/** Businesses that still have orders without a number (all of them when 062 was just applied). */
export async function tenantsMissingOrderNumbers(sql: Sql): Promise<string[]> {
  const rows = await sql<{ tenantId: string }[]>`
    SELECT DISTINCT "tenantId" FROM "Order" WHERE "orderNo" IS NULL ORDER BY "tenantId"`
  return rows.map((r) => r.tenantId)
}
