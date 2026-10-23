/**
 * Real-Postgres proof for short order numbers (SQL 062). LOCAL / LOOPBACK ONLY.
 *
 *   docker run -d --rm --name lanej-pg -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55432:5432 postgres:16
 *   npm run test:order-number-pg
 *
 * Env:
 *   ORDER_NUMBER_TEST_DATABASE_URL  admin URL (default postgresql://postgres:postgres@127.0.0.1:55432/postgres)
 *   ORDER_NUMBER_TEST_REQUIRED=1    fail (instead of skip) when the database is unreachable
 *
 * Creates a throwaway database from schema.prisma (`prisma migrate diff --from-empty`, no DB touched), seeds two
 * businesses with pre-062 orders and proves: fallback before 062 (no throw, no numbers), the trigger seed (new
 * orders start after the old ones), 20 concurrent READ COMMITTED creates, 20 concurrent SERIALIZABLE lifecycle
 * creates (createLifecycleOrder + withSerializationRetry, the real code), per-tenant isolation of numbers and
 * lookups, the backfill (creation order, idempotent) and the self-healing counter. Drops the database at the end.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'

const adminUrl = process.env.ORDER_NUMBER_TEST_DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:55432/postgres'
const admin = new URL(adminUrl)
if (!['localhost', '127.0.0.1', '::1'].includes(admin.hostname)) {
  throw new Error(`Refusing non-loopback ORDER_NUMBER_TEST_DATABASE_URL host: ${admin.hostname}`)
}
const dbName = `order_number_test_${process.pid}`
const testUrl = (() => {
  const u = new URL(adminUrl)
  u.pathname = `/${dbName}`
  return u.toString()
})()

async function check(name: string, fn: () => unknown) {
  await fn()
  console.log(`ok - ${name}`)
}

async function main() {
  const adminSql = postgres(adminUrl, { max: 1, onnotice: () => {} })
  try {
    await adminSql`SELECT 1`
  } catch (error) {
    if (process.env.ORDER_NUMBER_TEST_REQUIRED === '1') throw error
    console.log(`SKIP: no local Postgres at ${admin.host} (${(error as Error).message})`)
    await adminSql.end({ timeout: 1 })
    return
  }
  await adminSql.unsafe(`DROP DATABASE IF EXISTS ${dbName}`)
  await adminSql.unsafe(`CREATE DATABASE ${dbName}`)

  // Point the app's prisma singleton at the throwaway database BEFORE importing app code.
  process.env.DATABASE_URL = testUrl
  process.env.DIRECT_URL = testUrl
  const ddl = execFileSync('npx', ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const sql = postgres(testUrl, { max: 30, onnotice: () => {} })
  const { prisma } = await import('../src/lib/db')
  const { createLifecycleOrder } = await import('../src/lib/order-lifecycle')
  const server = await import('../src/lib/orders/order-number-server')
  const { backfillTenantOrderNumbers } = await import('../src/lib/orders/order-number-backfill')

  try {
    // schema.prisma references this sequence (SQL 024) as a column default.
    await sql.unsafe('CREATE SEQUENCE IF NOT EXISTS public."ChatConversation_revision_seq"')
    await sql.unsafe(ddl)
    const T1 = 'tenant_one'
    const T2 = 'tenant_two'
    for (const id of [T1, T2]) {
      await sql`INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES (${id}, ${id}, ${id}, now())`
    }
    await sql`INSERT INTO "User" ("id", "email", "updatedAt") VALUES ('test', 'test@example.test', now())`
    // Pre-062 orders, inserted out of creation order (timestamps decide), one archived.
    const legacy = [
      { id: 'L3', tenantId: T1, ts: '2026-01-03T10:00:00Z', deleted: false },
      { id: 'L1', tenantId: T1, ts: '2026-01-01T10:00:00Z', deleted: false },
      { id: 'L5', tenantId: T1, ts: '2026-01-05T10:00:00Z', deleted: false },
      { id: 'L2', tenantId: T1, ts: '2026-01-02T10:00:00Z', deleted: true },
      { id: 'L4', tenantId: T1, ts: '2026-01-04T10:00:00Z', deleted: false },
      { id: 'M2', tenantId: T2, ts: '2026-02-02T10:00:00Z', deleted: false },
      { id: 'M1', tenantId: T2, ts: '2026-02-01T10:00:00Z', deleted: false },
    ]
    for (const o of legacy) {
      await sql`INSERT INTO "Order" ("id", "tenantId", "orderId", "orderType", "customerName", "timestamp", "deletedAt")
        VALUES (${o.id}, ${o.tenantId}, ${'ORDER-' + o.id}, 'EA', 'Cliente', ${o.ts}, ${o.deleted ? new Date() : null})`
    }

    // 1) Before 062: helpers never throw and return nothing → UI shows the long id.
    server.resetOrderNoColumnCache()
    const before = await server.loadOrderNos(T1, ['L1', 'L3'])
    await check('before 062: loadOrderNos is empty (column missing → fallback)', () => assert.equal(before.size, 0))
    await check('before 062: findOrderIdByNo is null', async () => assert.equal(await server.findOrderIdByNo(T1, 1), null))

    // 1b) Baseline: the same SERIALIZABLE burst BEFORE 062, so the counter's own cost is visible.
    const burst = async (tenantId: string, tag: string) => {
      const settled = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          createLifecycleOrder({
            tenantId,
            userId: 'test',
            adapter: 'ventas',
            idempotencyKey: `ventas:create:ORDER-${tag}-${i}`,
            data: { tenantId, orderId: `ORDER-${tag}-${i}`, customerName: `${tag} ${i}`, phone: `88${tag.length}0${String(i).padStart(4, '0')}`, product: 'Algo', quantity: 1 },
          }),
        ),
      )
      return settled
    }
    const T3 = 'tenant_three'
    await sql`INSERT INTO "Tenant" ("id", "name", "slug", "updatedAt") VALUES (${T3}, ${T3}, ${T3}, now())`
    const baseline = await burst(T3, 'BASE')
    console.log(`info - baseline serializable burst BEFORE 062: ${baseline.filter((r) => r.status === 'fulfilled').length}/20 created`)

    // 2) Apply 062 exactly as shipped, twice (idempotent).
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/062_order_number.sql'), 'utf8')
    const one = postgres(testUrl, { max: 1, onnotice: () => {} }) // the file has its own BEGIN/COMMIT
    await one.unsafe(migration)
    await one.unsafe(migration)
    await one.end({ timeout: 2 })
    server.resetOrderNoColumnCache()
    console.log('ok - 062 applies cleanly twice')

    // 3) First new order after 062 starts after the 5 old ones (1..5 stay free for the backfill).
    const first = await prisma.order.create({
      data: { tenantId: T1, orderId: 'ORDER-NEW-0', orderType: 'EA', customerName: 'Nuevo' },
      select: { id: true },
    })
    await check('first order after 062 gets #6 (1..5 stay free for the old orders)', async () => assert.equal(await server.loadOrderNo(T1, first.id), 6))

    // 4) 20 concurrent creates (READ COMMITTED, like the legacy Ventas path and the website legacy path).
    const plain = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        prisma.order.create({ data: { tenantId: T1, orderId: `ORDER-RC-${i}`, orderType: 'EA', customerName: `RC ${i}` }, select: { id: true } }),
      ),
    )
    const plainNos = [...(await server.loadOrderNos(T1, plain.map((o) => o.id))).values()].sort((a, b) => a - b)
    await check('20 concurrent creates: 20 distinct contiguous numbers 7..26', () =>
      assert.deepEqual(plainNos, Array.from({ length: 20 }, (_, i) => 7 + i)))

    // 5) 20 concurrent SERIALIZABLE lifecycle creates (real createLifecycleOrder + withSerializationRetry).
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createLifecycleOrder({
          tenantId: T1,
          userId: 'test',
          adapter: 'ventas',
          idempotencyKey: `ventas:create:ORDER-SER-${i}`,
          data: { tenantId: T1, orderId: `ORDER-SER-${i}`, customerName: `Ser ${i}`, phone: `8800${String(i).padStart(4, '0')}`, product: 'Algo', quantity: 1 },
        }),
      ),
    )
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    const okIds = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.order.id] : []))
    console.log(`info - serializable burst: ${okIds.length}/20 created, ${failed.length} failed after retries${failed[0] ? ` (first error: ${String((failed[0].reason as { code?: string })?.code || failed[0].reason).slice(0, 120)})` : ''}`)
    for (const f of failed) {
      const code = (f.reason as { code?: string })?.code
      await check(`serializable failure surfaces as Prisma P2034 (retryable), not a duplicate number (${code})`, () => assert.equal(code, 'P2034'))
    }
    const serNos = [...(await server.loadOrderNos(T1, okIds)).values()]
    await check('serializable creates: every created order has a distinct number above 26', () => {
      assert.equal(serNos.length, okIds.length)
      assert.equal(new Set(serNos).size, serNos.length)
      assert.ok(serNos.every((n) => n > 26))
    })

    // 6) Tenant isolation: T2 has its own sequence; lookups never cross tenants.
    const t2 = await prisma.order.create({ data: { tenantId: T2, orderId: 'ORDER-T2-NEW', orderType: 'EA', customerName: 'Otro' }, select: { id: true } })
    assert.equal(await server.loadOrderNo(T2, t2.id), 3)
    console.log('ok - second business numbers independently (#3 after its 2 old orders)')
    await check('number lookups never cross businesses', async () => {
      assert.equal((await server.loadOrderNos(T2, [first.id])).size, 0)
      assert.equal(await server.findOrderIdByNo(T2, 6), null)
      assert.equal(await server.findOrderIdByNo(T1, 6), first.id)
      assert.equal(await server.findOrderIdByNo(T2, 3), t2.id)
    })

    // 7) Backfill: dry run writes nothing; apply numbers the old orders 1..5 in creation order (archived included).
    const dry = await backfillTenantOrderNumbers(sql, T1, false)
    assert.equal(dry.missing, 5)
    assert.equal((await sql`SELECT count(*)::int AS n FROM "Order" WHERE "tenantId" = ${T1} AND "orderNo" IS NULL`)[0].n, 5)
    console.log('ok - dry run plans 5 and writes nothing')
    const applied = await backfillTenantOrderNumbers(sql, T1, true)
    assert.deepEqual([applied.missing, applied.firstNo, applied.lastNo], [5, 1, 5])
    const legacyNos = await sql<{ id: string; orderNo: number }[]>`
      SELECT "id", "orderNo" FROM "Order" WHERE "tenantId" = ${T1} AND "id" LIKE 'L%' ORDER BY "orderNo"`
    await check('backfill numbers old orders in creation order: L1..L5 → #1..#5', () =>
      assert.deepEqual(legacyNos.map((r) => `${r.id}:${r.orderNo}`), ['L1:1', 'L2:2', 'L3:3', 'L4:4', 'L5:5']))
    const again = await backfillTenantOrderNumbers(sql, T1, true)
    await check('backfill is idempotent (second run: nothing to do)', () => assert.equal(again.missing, 0))
    const t2Fill = await backfillTenantOrderNumbers(sql, T2, true)
    const t2Nos = await sql<{ id: string; orderNo: number }[]>`SELECT "id", "orderNo" FROM "Order" WHERE "tenantId" = ${T2} ORDER BY "orderNo"`
    await check('backfill second business: M1 #1, M2 #2, new order keeps #3', () => {
      assert.equal(t2Fill.missing, 2)
      assert.deepEqual(t2Nos.map((r) => `${r.id}:${r.orderNo}`), ['M1:1', 'M2:2', `${t2.id}:3`])
    })
    const counter = await sql<{ lastNo: number }[]>`SELECT "lastNo" FROM "OrderNumberCounter" WHERE "tenantId" = ${T1}`
    const maxNo = await sql<{ m: number }[]>`SELECT max("orderNo")::int AS m FROM "Order" WHERE "tenantId" = ${T1}`
    await check('counter equals the highest number after backfill', () => assert.equal(counter[0].lastNo, maxNo[0].m))

    // 8) Self-heal: a counter that fell behind (restore, manual edit) never hands out a duplicate.
    await sql`UPDATE "OrderNumberCounter" SET "lastNo" = 0 WHERE "tenantId" = ${T1}`
    const healed = await prisma.order.create({ data: { tenantId: T1, orderId: 'ORDER-HEAL', orderType: 'EA', customerName: 'Heal' }, select: { id: true } })
    await check('lowered counter self-heals to max + 1', async () => assert.equal(await server.loadOrderNo(T1, healed.id), maxNo[0].m + 1))

    // 9) The unique index is the backstop: a manual duplicate is rejected.
    await assert.rejects(sql`UPDATE "Order" SET "orderNo" = 1 WHERE "id" = ${healed.id}`, /Order_tenantId_orderNo_key|duplicate/)
    console.log('ok - unique (tenantId, orderNo) rejects a duplicate')

    // 10) An explicit orderNo (restore with triggers on) is kept, not renumbered.
    await sql`INSERT INTO "Order" ("id", "tenantId", "orderId", "orderType", "customerName", "orderNo") VALUES ('R1', ${T2}, 'ORDER-R1', 'EA', 'R', 500)`
    await check('explicit orderNo is kept', async () => assert.equal(await server.loadOrderNo(T2, 'R1'), 500))
    console.log('PASS order-number-pg')
  } finally {
    await prisma.$disconnect().catch(() => {})
    await sql.end({ timeout: 2 })
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await adminSql.end({ timeout: 2 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
