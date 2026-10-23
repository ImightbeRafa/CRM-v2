/**
 * Backfill of short order numbers (SQL 062) for orders created before the trigger existed.
 *
 * Rule: per business, the orders without a number get the smallest free positive numbers, in creation order
 * ("timestamp", id) — archived orders included, so a number is never reused for another order. Normally the
 * trigger left 1..N free for the N old orders, so they become #1..#N in the order they were created.
 * Idempotent: only rows with "orderNo" IS NULL are touched; a second run finds nothing to do.
 * Raw SQL on purpose: it does not bump "updatedAt" (Prisma's @updatedAt is client-side), so no order looks edited.
 * (Take a backup after it: unchanged updatedAt means the hot backup may reuse the previous Order artifact.)
 *
 * Locking (apply): one SHORT transaction first raises the counter to at least the number of orders of the
 * business (and its max number). From then on new orders get numbers above it, and every free slot the old
 * orders need is at or below it — so the numbering itself runs in small batches WITHOUT holding the counter,
 * and order creation never waits on the backfill.
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

async function readPlan(sql: Sql, tenantId: string) {
  const takenRows = await sql<{ orderNo: number }[]>`
    SELECT "orderNo" FROM "Order" WHERE "tenantId" = ${tenantId} AND "orderNo" IS NOT NULL`
  const missingRows = await sql<{ id: string }[]>`
    SELECT "id" FROM "Order" WHERE "tenantId" = ${tenantId} AND "orderNo" IS NULL ORDER BY "timestamp" ASC, "id" ASC`
  return planOrderNumbers(takenRows.map((r) => Number(r.orderNo)), missingRows.map((r) => r.id))
}

function summary(tenantId: string, plan: OrderNoAssignment[], counterBefore: number | null, counterAfter: number | null, applied: boolean): TenantBackfillResult {
  return {
    tenantId,
    missing: plan.length,
    firstNo: plan.length ? plan[0].orderNo : null,
    lastNo: plan.length ? plan[plan.length - 1].orderNo : null,
    counterBefore,
    counterAfter,
    applied,
  }
}

/** One business. Dry run = read-only (plan only). */
export async function backfillTenantOrderNumbers(sql: Sql, tenantId: string, apply: boolean): Promise<TenantBackfillResult> {
  const before = await sql<{ lastNo: number }[]>`SELECT "lastNo" FROM "OrderNumberCounter" WHERE "tenantId" = ${tenantId}`
  const counterBefore = before[0] ? Number(before[0].lastNo) : null
  if (!apply) {
    const plan = await readPlan(sql, tenantId)
    return summary(tenantId, plan, counterBefore, counterBefore, false)
  }

  // 1) Short transaction: counter ≥ max(rows, max orderNo). Same row the trigger locks, held for milliseconds.
  const raised = (await sql.begin(async (tx) => {
    await tx`SET LOCAL lock_timeout = '3s'`
    await tx`SET LOCAL statement_timeout = '15s'`
    return tx<{ lastNo: number }[]>`
      INSERT INTO "OrderNumberCounter" AS c ("tenantId", "lastNo", "updatedAt")
      VALUES (
        ${tenantId},
        GREATEST(
          (SELECT count(*) FROM "Order" o WHERE o."tenantId" = ${tenantId}),
          COALESCE((SELECT max(o."orderNo") FROM "Order" o WHERE o."tenantId" = ${tenantId}), 0)
        ),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenantId") DO UPDATE
        SET "lastNo" = GREATEST(c."lastNo", EXCLUDED."lastNo"), "updatedAt" = CURRENT_TIMESTAMP
      RETURNING c."lastNo"`
  })) as unknown as { lastNo: number }[]
  const counterAfter = Number(raised[0]?.lastNo ?? 0)

  // 2) Plan from committed data: new orders now land above counterAfter, so every planned number is ≤ it.
  const plan = await readPlan(sql, tenantId)
  const top = plan.reduce((m, p) => Math.max(m, p.orderNo), 0)
  if (top > counterAfter) {
    throw new Error(`order-number backfill ${tenantId}: planned #${top} above counter ${counterAfter}; aborting (nothing written)`)
  }

  // 3) Small independent batches; each only fills rows that are still NULL. The unique index is the backstop.
  for (let i = 0; i < plan.length; i += BATCH) {
    const chunk = plan.slice(i, i + BATCH)
    await sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '3s'`
      await tx`SET LOCAL statement_timeout = '30s'`
      await tx`
        UPDATE "Order" AS o SET "orderNo" = v.no
        FROM (SELECT unnest(${chunk.map((p) => p.id)}::text[]) AS id, unnest(${chunk.map((p) => p.orderNo)}::int[]) AS no) AS v
        WHERE o."id" = v.id AND o."tenantId" = ${tenantId} AND o."orderNo" IS NULL`
    })
  }
  return summary(tenantId, plan, counterBefore, counterAfter, plan.length > 0)
}

/** Businesses that still have orders without a number (all of them when 062 was just applied). */
export async function tenantsMissingOrderNumbers(sql: Sql): Promise<string[]> {
  const rows = await sql<{ tenantId: string }[]>`
    SELECT DISTINCT "tenantId" FROM "Order" WHERE "orderNo" IS NULL ORDER BY "tenantId"`
  return rows.map((r) => r.tenantId)
}
