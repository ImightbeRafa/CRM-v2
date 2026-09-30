import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { hasPermission } from '../rbac'
import { serializeExport, type CustomerExport } from '../data-subject/export'

const SRC = readFileSync('src/lib/data-subject/export.ts', 'utf8')
const ROUTE = readFileSync('src/app/api/clients/[id]/data-export/route.ts', 'utf8')

/** Every Prisma model call in the export module, with its argument text. */
function prismaCalls(src: string): Array<{ model: string; args: string }> {
  const calls: Array<{ model: string; args: string }> = []
  const re = /prisma\.(\w+)\s*\.\s*(findMany|findFirst|findUnique|count)\(/g
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

test('every Prisma read in the export is scoped to the business explicitly', () => {
  const calls = prismaCalls(SRC)
  assert.ok(calls.length >= 10, `expected the full set of reads, got ${calls.length}`)
  for (const c of calls) {
    assert.match(c.args, /where:\s*\{\s*(id: clientId, )?tenantId\b/, `prisma.${c.model} is missing an explicit tenantId`)
  }
  // No writes of any kind.
  assert.doesNotMatch(SRC, /\.(create|update|upsert|delete)(Many)?\(/)
  assert.doesNotMatch(SRC, /\$executeRaw|INSERT|UPDATE |DELETE /)
})

test('logistics (lm_*) rows are read only through this business order ids, with the business id', () => {
  const raws = SRC.match(/\$queryRaw<[^>]+>`[\s\S]*?`/g) || []
  const lm = raws.filter((r) => /lm_/.test(r) && !/to_regclass/.test(r))
  assert.equal(lm.length, 2)
  for (const r of lm) {
    assert.match(r, /crm_order_id = ANY\(\$\{orderIds\}::text\[\]\)/)
    assert.match(r, /crm_tenant_id = \$\{tenantId\}/)
  }
  // orderIds come from the business-scoped Order query.
  assert.match(SRC, /prisma\.order\.findMany\(\{\s*where: \{ tenantId, clientId \}/)
  assert.match(SRC, /const orderIds = orders\.map\(\(o\) => o\.id\)/)
  // Guarded: some lm_* tables are created outside this repo.
  assert.match(SRC, /to_regclass/)
})

test('large files are listed, not embedded; the customer must belong to the business', () => {
  assert.doesNotMatch(SRC, /pdfData: true/)
  assert.match(SRC, /pdfFileName: true/)
  assert.doesNotMatch(SRC, /mediaBlobPath|metadata: true/)
  assert.match(SRC, /prisma\.client\.findFirst\(\{ where: \{ id: clientId, tenantId \} \}\)/)
  assert.match(SRC, /if \(!customer\) return null/)
  // Caps (a 413 instead of an unbounded response).
  assert.match(SRC, /take: EXPORT_LIMITS\.orders \+ 1/)
  assert.match(SRC, /take: EXPORT_LIMITS\.messages \+ 1/)
})

test('route: owner only, rate limited, no-store, audited with counts only', () => {
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

test('serialization handles raw SQL types (BigInt / Decimal) and keeps dates ISO', () => {
  class Decimal {
    constructor(private readonly v: string) {}
    toString() {
      return this.v
    }
  }
  const data = {
    format: 'betsy-customer-export',
    version: 1,
    generatedAt: '2026-09-30T00:00:00.000Z',
    logistics: { orders: [{ id: BigInt(7), weight_kg: new Decimal('1.50'), created_at: new Date('2026-01-02T03:04:05Z') }], events: [] },
  } as unknown as CustomerExport
  const parsed = JSON.parse(serializeExport(data))
  assert.deepEqual(parsed.logistics.orders[0], { id: '7', weight_kg: '1.50', created_at: '2026-01-02T03:04:05.000Z' })
})
