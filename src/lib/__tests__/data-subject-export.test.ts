import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { hasPermission } from '../rbac'
import { ExportTooLargeError, serializeExport, type CustomerExport } from '../data-subject/export'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const SRC = read('src/lib/data-subject/export.ts')
const ROUTE = read('src/app/api/clients/[id]/data-export/route.ts')

/** Every Prisma model read in the export module, with its argument text. */
function prismaCalls(src: string): Array<{ model: string; args: string }> {
  const calls: Array<{ model: string; args: string }> = []
  const re = /prisma(?:Raw)?\.(\w+)\s*\.\s*(findMany|findFirst|findUnique|count)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1
      else if (src[i] === ')') depth -= 1
      i += 1
    }
    calls.push({ model: m[1], args: src.slice(re.lastIndex, i - 1) })
  }
  return calls
}

test('every read in the export is scoped to the business explicitly; no writes', () => {
  const calls = prismaCalls(SRC)
  assert.ok(calls.length >= 9, `expected the full set of reads, got ${calls.length}`)
  for (const c of calls) {
    assert.match(
      c.args,
      /where:\s*(\{\s*(id: clientId, |\.\.\.linked, )?tenantId\b|\{ \.\.\.linked|linked\b|customerMessageWhere\(tenantId|\{ tenantId, (id|OR)\b)/,
      `prisma.${c.model} is missing an explicit tenantId`,
    )
  }
  assert.doesNotMatch(SRC, /\.(create|update|upsert|delete)(Many)?\(/)
  assert.doesNotMatch(SRC, /\$executeRaw|INSERT|UPDATE |DELETE /)
})

test('same records as the erasure: orders by customer OR phone / email, archived included', () => {
  assert.match(SRC, /const records = await findCustomerRecords\(tenantId, clientId\)/)
  assert.match(SRC, /prismaRaw\.order\.findMany\(\{ where: \{ tenantId, id: \{ in: orderIdsAll \} \}/)
  assert.match(SRC, /archived: o\.deletedAt !== null/)
})

test('only the customer own data: no seller / product cost / archive notes, no logistics costs or staff emails', () => {
  const orderFields = SRC.slice(SRC.indexOf('const ORDER_FIELDS'), SRC.indexOf('} as const', SRC.indexOf('const ORDER_FIELDS')))
  for (const internal of ['seller', 'productCost', 'funnel', 'salesChannel', 'deletedBy', 'deleteReason', 'archiveMetadata']) {
    assert.doesNotMatch(orderFields, new RegExp(`\\b${internal}:`), internal)
  }
  const raws = SRC.match(/\$queryRaw<[^>]+>`[\s\S]*?`/g) || []
  const lm = raws.filter((r) => /lm_/.test(r) && !/to_regclass/.test(r))
  assert.equal(lm.length, 2)
  for (const r of lm) {
    assert.doesNotMatch(r, /SELECT \*|e\.\*|o\.\*|actor|billed|cost/i, 'explicit allowlist (DATA-21)')
    assert.match(r, /crm_order_id = ANY\(\$\{orderIds\}::text\[\]\)/)
    assert.match(r, /crm_tenant_id = \$\{tenantId\}/)
  }
  assert.match(SRC, /to_regclass/)
})

test('large files are listed, not embedded; caps on rows AND bytes (413)', () => {
  assert.doesNotMatch(SRC, /pdfData: true/)
  assert.match(SRC, /pdfFileName: true/)
  assert.doesNotMatch(SRC, /mediaBlobPath|metadata: true/)
  assert.match(SRC, /if \(!customer\) return null/)
  assert.match(SRC, /take: EXPORT_LIMITS\.messages \+ 1/)
  assert.match(SRC, /export const EXPORT_MAX_BYTES = 25 \* 1024 \* 1024/)
  const big = { format: 'betsy-customer-export', blob: 'x'.repeat(2000) } as unknown as CustomerExport
  assert.throws(() => serializeExport(big, 1000), (e: unknown) => e instanceof ExportTooLargeError)
})

test('route: standby switch, owner only, rate limited, no-store, audited with counts only', () => {
  assert.ok(ROUTE.indexOf('dataSubjectRequestsEnabled()') < ROUTE.indexOf('authenticateAPIWithPermission('))
  assert.match(ROUTE, /authenticateAPIWithPermission\(request, 'manage_tenant'\)/)
  assert.equal(hasPermission('OWNER', 'manage_tenant'), true)
  for (const role of ['ADMIN', 'MANAGER', 'SALES', 'VIEWER'] as const) {
    assert.equal(hasPermission(role as never, 'manage_tenant'), false, role)
  }
  assert.match(ROUTE, /buildCustomerExport\(auth\.tenantId, id\)/)
  assert.match(ROUTE, /exportLimit\(`customer-export:\$\{auth\.tenantId\}`\)/)
  assert.match(ROUTE, /PII_NO_STORE_HEADERS/)
  assert.match(ROUTE, /'Content-Disposition': `attachment;/)
  assert.match(ROUTE, /newValues: \{ counts: data\.counts \}/)
  assert.doesNotMatch(ROUTE, /newValues: \{[^}]*customer/)
  assert.match(ROUTE, /status: 413/)
})

test('serialization handles raw SQL types (BigInt / Decimal), keeps dates ISO, compact', () => {
  class Decimal {
    constructor(private readonly v: string) {}
    toString() {
      return this.v
    }
  }
  const data = {
    format: 'betsy-customer-export',
    version: 2,
    generatedAt: '2026-09-30T00:00:00.000Z',
    logistics: { orders: [{ id: BigInt(7), weight_kg: new Decimal('1.50'), created_at: new Date('2026-01-02T03:04:05Z') }], events: [] },
  } as unknown as CustomerExport
  const json = serializeExport(data)
  assert.ok(!json.includes('\n'), 'no indentation')
  assert.deepEqual(JSON.parse(json).logistics.orders[0], { id: '7', weight_kg: '1.50', created_at: '2026-01-02T03:04:05.000Z' })
})
