/** Export formula injection + tenant dump permission + xlsx zip-bomb guard (security, 2026-09-28). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { csvCell, neutralizeCsvFormula } from '../csv-safe'
import { neutralizeCsvFormula as serverNeutralize } from '../security'
import { hasPermission } from '../rbac'
import { XLSX_MAX_ENTRIES, xlsxArchiveProblem } from '../import-helpers'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('formula triggers are neutralized, including | and full-width forms', () => {
  for (const v of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=x', '\r=x', '|cmd', '＝1', '＋1', '－1', '＠x']) {
    assert.equal(neutralizeCsvFormula(v), `'${v}`, JSON.stringify(v))
  }
  for (const v of ['Ana', '506 8888', '', 'a=b']) assert.equal(neutralizeCsvFormula(v), v)
  assert.equal(serverNeutralize('=x'), "'=x", 'server re-export is the same rule')
})

test('csvCell: text quoted + neutralized, numbers untouched (negative amounts stay numbers)', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
  assert.equal(csvCell(-500), '-500')
  assert.equal(csvCell(null), '""')
})

test('every client-side CSV exporter goes through csvCell', () => {
  for (const f of [
    'src/app/components/SimpleAuditDashboard.tsx',
    'src/app/logistics/accounting/page.tsx',
    'src/app/logistics/mensajeria-privada/page.tsx',
    'src/app/logistics/reports/page.tsx',
    'src/app/logistics/workforce/page.tsx',
    'src/app/produccion/components/ExportManager.tsx',
  ]) {
    const src = read(f)
    assert.match(src, /import \{ csvCell \} from '@\/lib\/csv-safe'/, f)
    assert.doesNotMatch(src, /`"\$\{[^`]*\}"`/, `${f}: hand-quoted cell`)
  }
})

test('server exports neutralize text', () => {
  assert.match(read('src/app/api/exports/sales/route.ts'), /typeof v === 'string' \? neutralizeCsvFormula\(v\) : v/)
  const db = read('src/app/api/exports/database/route.ts')
  assert.match(db, /flattenDatabaseData\(exportData\.data\)\.map/)
  assert.match(db, /typeof value === 'string'\s*\?\s*neutralizeCsvFormula\(value\)/)
})

test('full business dump: OWNER and ADMIN only, rate limited, audited', () => {
  assert.equal(hasPermission('OWNER', 'export_tenant_data'), true)
  assert.equal(hasPermission('ADMIN', 'export_tenant_data'), true)
  for (const r of ['MANAGER', 'SALES', 'PRODUCTION', 'VIEWER'] as const) assert.equal(hasPermission(r, 'export_tenant_data'), false, r)
  const db = read('src/app/api/exports/database/route.ts')
  assert.match(db, /authenticateAPIWithPermission\(request, 'export_tenant_data'\)/)
  assert.match(db, /exportRateLimit\(request\)/)
  assert.match(db, /action: 'EXPORT'/)
})

test('import preview needs the same permission as the import', () => {
  const src = read('src/app/api/import/preview/route.ts')
  assert.match(src, /authenticateAPIWithPermission\(request, 'create_sales'\)/)
  assert.doesNotMatch(src, /getServerSession/)
})

// Minimal zip writer: stored (method 0) or deflated entries, enough to exercise the central directory.
function zip(entries: Array<{ name: string; data: Buffer; fakeSize?: number }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const comp = zlib.deflateRawSync(e.data)
    const name = Buffer.from(e.name)
    const size = e.fakeSize ?? e.data.length
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8)
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10)
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

test('zip guard: a normal small workbook passes', () => {
  assert.equal(xlsxArchiveProblem(zip([{ name: '[Content_Types].xml', data: Buffer.from('<x/>') }, { name: 'xl/workbook.xml', data: Buffer.from('<w/>') }])), null)
})

test('zip guard: huge declared expansion, too many entries, garbage and zip64 are refused', () => {
  assert.ok(xlsxArchiveProblem(zip([{ name: 'xl/sheet1.xml', data: Buffer.alloc(1000), fakeSize: 200 * 1024 * 1024 }])))
  const many = Array.from({ length: XLSX_MAX_ENTRIES + 1 }, (_, i) => ({ name: `f${i}`, data: Buffer.from('a') }))
  assert.ok(xlsxArchiveProblem(zip(many)))
  assert.ok(xlsxArchiveProblem(Buffer.from('not a zip at all, just text')))
  assert.ok(xlsxArchiveProblem(zip([{ name: 'a', data: Buffer.from('a'), fakeSize: 0xffffffff }])))
})

test('both xlsx loaders run the guard before ExcelJS inflates', () => {
  for (const f of ['src/app/api/import/excel/route.ts', 'src/app/api/import/preview/route.ts']) {
    const src = read(f)
    assert.ok(src.indexOf('xlsxArchiveProblem(buffer)') > 0 && src.indexOf('xlsxArchiveProblem(buffer)') < src.indexOf('workbook.xlsx.load('), f)
  }
})
