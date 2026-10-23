/**
 * Optional backfill: exact product names (`itemName`) on existing orders, ONLY where productDetails already
 * carries an `inventoryItemId` that resolves to an inventory item of the SAME business. Nothing is guessed from
 * text. Only the `itemName` key is added: `type`, `sku`, `product` (stock matching, Correos, exports) are never
 * touched, and "updatedAt" is not bumped.
 *
 * Dry-run (default, read-only):
 *   npx tsx scripts/order-item-names-backfill.ts [--tenant=<id>] [--days=<n>]
 *
 * Apply (shared PROD database — only with Rafael's GO):
 *   ORDER_ITEM_NAMES_BACKFILL_APPLY=1 \
 *   ORDER_ITEM_NAMES_BACKFILL_CONFIRM_HOST=<exact DIRECT_URL hostname> \
 *   npx tsx scripts/order-item-names-backfill.ts --apply [--tenant=<id>] [--days=<n>]
 *
 * Idempotent: items that already have itemName are skipped; each UPDATE also requires productDetails to be
 * unchanged since it was read (a concurrent edit wins).
 */
import postgres from 'postgres'
import { fillItemNames } from '../src/lib/orders/generic-product'

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.slice(9).trim() || null
const daysArg = Number(args.find((a) => a.startsWith('--days='))?.slice(7))
const since = Number.isFinite(daysArg) && daysArg > 0 ? new Date(Date.now() - daysArg * 86_400_000) : new Date(0)
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!dbUrl) fail('DIRECT_URL / DATABASE_URL is missing.')
const host = new URL(dbUrl).hostname
if (apply) {
  if (process.env.ORDER_ITEM_NAMES_BACKFILL_APPLY !== '1') fail('Apply blocked: set ORDER_ITEM_NAMES_BACKFILL_APPLY=1 after human approval.')
  const confirmHost = process.env.ORDER_ITEM_NAMES_BACKFILL_CONFIRM_HOST
  if (!confirmHost) fail('Apply blocked: set ORDER_ITEM_NAMES_BACKFILL_CONFIRM_HOST to the exact DB hostname.')
  if (confirmHost !== host) fail(`Host mismatch: url has ${host}, confirm host is ${confirmHost}.`)
}
const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(host)
const sql = postgres(dbUrl, {
  max: 1,
  ssl: isLoopback ? false : 'require',
  prepare: false,
  onnotice: () => {},
  ...(apply ? {} : { connection: { default_transaction_read_only: true } }),
})

type Row = { id: string; tenantId: string; productDetails: string }

async function main() {
  const rows = tenantArg
    ? await sql<Row[]>`
        SELECT "id", "tenantId", "productDetails" FROM "Order"
        WHERE "tenantId" = ${tenantArg} AND "timestamp" >= ${since}
          AND "productDetails" LIKE '%"inventoryItemId"%'`
    : await sql<Row[]>`
        SELECT "id", "tenantId", "productDetails" FROM "Order"
        WHERE "timestamp" >= ${since} AND "productDetails" LIKE '%"inventoryItemId"%'`
  const byTenant = new Map<string, Row[]>()
  for (const row of rows) byTenant.set(row.tenantId, [...(byTenant.get(row.tenantId) ?? []), row])

  let planned = 0
  let written = 0
  for (const [tenantId, list] of byTenant) {
    const ids = new Set<string>()
    for (const row of list) for (const m of row.productDetails.matchAll(/"inventoryItemId"\s*:\s*"([^"]{1,64})"/g)) ids.add(m[1])
    // Same business only: an id of another tenant never resolves.
    const items = ids.size
      ? await sql<{ id: string; name: string }[]>`
          SELECT "id", "name" FROM "InventoryItem" WHERE "tenantId" = ${tenantId} AND "id" = ANY(${[...ids]}::text[])`
      : []
    const names = new Map(items.map((i) => [i.id, i.name]))
    let tenantPlanned = 0
    let tenantWritten = 0
    for (const row of list) {
      const next = fillItemNames(row.productDetails, names)
      if (!next) continue
      tenantPlanned += 1
      if (apply) {
        const res = await sql`
          UPDATE "Order" SET "productDetails" = ${next}
          WHERE "id" = ${row.id} AND "tenantId" = ${tenantId} AND "productDetails" = ${row.productDetails}`
        tenantWritten += res.count
      }
    }
    planned += tenantPlanned
    written += tenantWritten
    console.log(JSON.stringify({ tenantId, candidates: list.length, fillable: tenantPlanned, written: tenantWritten }))
  }
  console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', host, tenants: byTenant.size, fillable: planned, written }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
