/**
 * READ-ONLY report: how many recent orders name a generic product ("1x Parche") instead of the exact item,
 * per business. The connection is opened with default_transaction_read_only=on, so it cannot write.
 *
 *   npx tsx scripts/order-names-report.ts [--days=30] [--tenant=<id>] [--json]
 *
 * Rule: src/lib/orders/generic-product.ts (generic word, or an inventory category that is not an item name).
 * Also counts orders whose productDetails carry an inventoryItemId without itemName (what
 * scripts/order-item-names-backfill.ts could fill).
 */
import postgres from 'postgres'
import { genericLines, inventoryNames } from '../src/lib/orders/generic-product'

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const days = Math.min(365, Math.max(1, Number(args.find((a) => a.startsWith('--days='))?.slice(7)) || 30))
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.slice(9).trim() || null
const asJson = args.includes('--json')
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!dbUrl) fail('DIRECT_URL / DATABASE_URL is missing.')
const host = new URL(dbUrl).hostname
const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(host)
const sql = postgres(dbUrl, {
  max: 1,
  ssl: isLoopback ? false : 'require',
  prepare: false,
  onnotice: () => {},
  connection: { default_transaction_read_only: true, application_name: 'betsy-order-names-report' },
})

type Row = { id: string; tenantId: string; product: string | null; productDetails: string | null; external: boolean }

async function main() {
  const since = new Date(Date.now() - days * 86_400_000)
  const orders = tenantArg
    ? await sql<Row[]>`
        SELECT "id", "tenantId", "product", "productDetails", COALESCE(("customFields"->>'external')::boolean, false) AS external
        FROM "Order" WHERE "deletedAt" IS NULL AND "timestamp" >= ${since} AND "tenantId" = ${tenantArg}`
    : await sql<Row[]>`
        SELECT "id", "tenantId", "product", "productDetails", COALESCE(("customFields"->>'external')::boolean, false) AS external
        FROM "Order" WHERE "deletedAt" IS NULL AND "timestamp" >= ${since}`
  const tenantIds = [...new Set(orders.map((o) => o.tenantId))]
  if (tenantIds.length === 0) {
    console.log(asJson ? '[]' : `No orders in the last ${days} days.`)
    return
  }
  const tenants = await sql<{ id: string; name: string }[]>`SELECT "id", "name" FROM "Tenant" WHERE "id" = ANY(${tenantIds}::text[])`
  const items = await sql<{ tenantId: string; name: string | null; category: string | null }[]>`
    SELECT "tenantId", "name", "category" FROM "InventoryItem" WHERE "tenantId" = ANY(${tenantIds}::text[])`
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]))

  const report = tenantIds.map((tenantId) => {
    const inv = inventoryNames(items.filter((i) => i.tenantId === tenantId))
    const mine = orders.filter((o) => o.tenantId === tenantId)
    const names = new Map<string, number>()
    let generic = 0
    let genericWebsite = 0
    let fillable = 0
    for (const order of mine) {
      const lines = genericLines(order, inv)
      if (lines.length > 0) {
        generic += 1
        if (order.external) genericWebsite += 1
        for (const line of lines) names.set(line, (names.get(line) ?? 0) + 1)
      }
      if (order.productDetails && /"inventoryItemId"\s*:/.test(order.productDetails) && !/"itemName"\s*:/.test(order.productDetails)) fillable += 1
    }
    return {
      tenantId,
      business: tenantName.get(tenantId) ?? '(sin nombre)',
      orders: mine.length,
      generic,
      genericPct: mine.length ? Math.round((generic / mine.length) * 1000) / 10 : 0,
      genericFromWebsite: genericWebsite,
      topGenericNames: [...names].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => `${name} (${n})`),
      backfillableItemIds: fillable,
    }
  }).sort((a, b) => b.generic - a.generic)

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(`Orders with a generic product name, last ${days} days (read-only, host ${host})`)
  for (const r of report) {
    console.log(`- ${r.business}: ${r.generic}/${r.orders} (${r.genericPct}%), website ${r.genericFromWebsite}; ${r.topGenericNames.join(', ') || '—'}; backfillable ${r.backfillableItemIds}`)
  }
  const total = report.reduce((s, r) => s + r.orders, 0)
  const totalGeneric = report.reduce((s, r) => s + r.generic, 0)
  console.log(`TOTAL ${totalGeneric}/${total} orders across ${report.length} businesses`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
