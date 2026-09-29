/**
 * DATA-03 sign-off (2026-09-29): whatever the guard accepts, JSZip (what ExcelJS uses) must see
 * exactly the same entries — otherwise an attacker could show the guard one archive and ExcelJS
 * another. Plus the concurrency cap.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { acquireXlsxParseSlot, sanitizeXlsx, xlsxArchiveProblem, xlsxInspectedEntryNames } from '../xlsx-guard'

function zip(entries: Array<{ name: string; data: Buffer; method?: 0 | 8 }>, opts: { prefix?: Buffer; gapBeforeEocd?: number; trailingCd?: Buffer } = {}): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = opts.prefix?.length ?? 0
  for (const e of entries) {
    const method = e.method ?? 8
    const comp = method === 8 ? zlib.deflateRawSync(e.data) : e.data
    const name = Buffer.from(e.name)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26)
    locals.push(lh, name, comp)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat([...centrals, opts.trailingCd ?? Buffer.alloc(0)])
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([opts.prefix ?? Buffer.alloc(0), ...locals, cd, Buffer.alloc(opts.gapBeforeEocd ?? 0), eocd])
}

async function jszipNames(buf: Buffer): Promise<string[] | null> {
  try {
    const z = await JSZip.loadAsync(buf)
    return Object.keys(z.files).sort()
  } catch {
    return null
  }
}

const samples: Array<[string, Buffer]> = [
  ['plain', zip([{ name: 'a.xml', data: Buffer.from('<a/>') }, { name: 'xl/b.xml', data: Buffer.from('<b/>') }])],
  ['stored', zip([{ name: 'a.xml', data: Buffer.from('<a/>'), method: 0 }])],
  ['prefix junk (self-extractor style)', zip([{ name: 'a.xml', data: Buffer.from('<a/>') }], { prefix: Buffer.alloc(64, 1) })],
  ['gap before end record', zip([{ name: 'a.xml', data: Buffer.from('<a/>') }], { gapBeforeEocd: 16 })],
  ['hidden trailing directory bytes', zip([{ name: 'a.xml', data: Buffer.from('<a/>') }], { trailingCd: Buffer.alloc(46) })],
  ['duplicate names', zip([{ name: 'a.xml', data: Buffer.from('<1/>') }, { name: 'a.xml', data: Buffer.alloc(5000, 0x61) }])],
]

for (const [label, buf] of samples) {
  test(`differential vs JSZip: ${label}`, async () => {
    const guard = xlsxInspectedEntryNames(buf)
    if (guard === null) return // refused: ExcelJS never sees it
    const seen = await jszipNames(buf)
    assert.ok(seen, 'JSZip must open what the guard accepts')
    assert.deepEqual([...new Set(guard)].sort(), seen, 'same entries on both sides')
  })
}

test('a real ExcelJS workbook passes and matches JSZip', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Ordenes')
  for (let i = 0; i < 2000; i++) ws.addRow([`Cliente ${i}`, i])
  const buf = Buffer.from(await wb.xlsx.writeBuffer())
  assert.equal(xlsxArchiveProblem(buf), null)
  assert.deepEqual([...new Set(xlsxInspectedEntryNames(buf))].sort(), await jszipNames(buf))
})

test('at most 2 parses at once per process; slots are released', () => {
  const a = acquireXlsxParseSlot()
  const b = acquireXlsxParseSlot()
  assert.ok(a && b)
  assert.equal(acquireXlsxParseSlot(), null)
  a!()
  a!() // double release is harmless
  const c = acquireXlsxParseSlot()
  assert.ok(c)
  b!(); c!()
})

test('multi-disk / ZIP64 end-record fields are refused (JSZip would read another directory)', () => {
  const ok = zip([{ name: 'a.xml', data: Buffer.from('<a/>') }])
  const eocdAt = ok.length - 22
  for (const [off, value] of [[4, 0xffff], [6, 0xffff], [8, 0xffff], [4, 1], [8, 2]] as const) {
    const tampered = Buffer.from(ok)
    tampered.writeUInt16LE(value, eocdAt + off)
    assert.ok(xlsxArchiveProblem(tampered), `eocd+${off}=${value}`)
  }
})

test('sanitizeXlsx rebuilds a clean archive that ExcelJS reads identically', async () => {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Ordenes')
  ws.addRow(['Cliente', 'Total'])
  ws.addRow(['Ana ñandú', 5000])
  const original = Buffer.from(await wb.xlsx.writeBuffer())
  const result = await sanitizeXlsx(original)
  assert.equal(result.ok, true)
  if (!result.ok) return
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(result.clean as any)
  assert.equal(back.worksheets[0].name, 'Ordenes')
  assert.equal(back.worksheets[0].getRow(2).getCell(1).value, 'Ana ñandú')
  assert.equal(back.worksheets[0].getRow(2).getCell(2).value, 5000)
  // The rebuilt archive contains exactly the inspected entries.
  assert.deepEqual([...new Set(xlsxInspectedEntryNames(result.clean))].sort(), [...new Set(xlsxInspectedEntryNames(original))].sort())
})

test('sanitizeXlsx refuses what the guard refuses', async () => {
  const bomb = zip([{ name: 'x.xml', data: Buffer.alloc(50 * 1024 * 1024, 0x61) }])
  const r = await sanitizeXlsx(bomb)
  assert.equal(r.ok, false)
})
