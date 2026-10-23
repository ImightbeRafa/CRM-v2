/**
 * Short order numbers (SQL 062): number the orders created before the trigger, per business, in creation order.
 *
 * Dry-run (default, read-only):
 *   npx tsx scripts/order-number-backfill.ts [--tenant=<id>]
 *
 * Apply (shared PROD database — only with Rafael's GO, after 062 is applied):
 *   ORDER_NUMBER_BACKFILL_APPLY=1 \
 *   ORDER_NUMBER_BACKFILL_CONFIRM_HOST=<exact DIRECT_URL hostname> \
 *   npx tsx scripts/order-number-backfill.ts --apply [--tenant=<id>]
 *
 * Idempotent: only orders with "orderNo" IS NULL are numbered; running it again is a no-op.
 * One short transaction per business; it locks that business's counter row, so new orders wait a moment.
 * Rule and SQL: src/lib/orders/order-number-backfill.ts.
 */
import postgres from 'postgres'
import { backfillTenantOrderNumbers, tenantsMissingOrderNumbers } from '../src/lib/orders/order-number-backfill'

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const tenantArg = args.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length).trim() || null
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!dbUrl) fail('DIRECT_URL / DATABASE_URL is missing.')

let host = ''
try {
  host = new URL(dbUrl).hostname
} catch {
  fail('DATABASE URL is not a valid URL.')
}

if (apply) {
  if (process.env.ORDER_NUMBER_BACKFILL_APPLY !== '1') fail('Apply blocked: set ORDER_NUMBER_BACKFILL_APPLY=1 after human approval.')
  const confirmHost = process.env.ORDER_NUMBER_BACKFILL_CONFIRM_HOST
  if (!confirmHost) fail('Apply blocked: set ORDER_NUMBER_BACKFILL_CONFIRM_HOST to the exact DB hostname.')
  if (confirmHost !== host) fail(`Host mismatch: url has ${host}, confirm host is ${confirmHost}.`)
}

const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(host)
const sql = postgres(dbUrl, {
  max: 1,
  ssl: isLoopback ? false : 'require',
  prepare: false,
  onnotice: () => {},
  // Dry run cannot write, even by mistake.
  ...(apply ? {} : { connection: { default_transaction_read_only: true } }),
})

async function main() {
  const column = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Order' AND column_name = 'orderNo') AS ok`
  if (!column[0]?.ok) fail('SQL 062 is not applied ("Order"."orderNo" missing). Apply it first.')

  const tenants = tenantArg ? [tenantArg] : await tenantsMissingOrderNumbers(sql)
  const results = []
  for (const tenantId of tenants) {
    const result = await backfillTenantOrderNumbers(sql, tenantId, apply)
    results.push(result)
    console.log(JSON.stringify(result))
  }
  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    host,
    tenants: results.length,
    orders: results.reduce((sum, r) => sum + r.missing, 0),
  }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => sql.end({ timeout: 5 }))
