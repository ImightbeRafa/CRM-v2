import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  canalLabel,
  distinctLines,
  filterByLine,
  pickOrderLines,
  LINE_FILTER_ALL,
  LINE_FILTER_MANUAL,
} from '../order-channel-line'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const accounts = [
  { id: 'acc_wa', platform: 'whatsapp', displayName: 'PatchHouse CR', displayPhoneNumber: '+50688887777', providerUsername: null },
  { id: 'acc_ig', platform: 'instagram', displayName: null, displayPhoneNumber: null, providerUsername: 'patchhouse' },
]

test('pickOrderLines: latest message per order wins, unknown accounts are skipped', () => {
  const lines = pickOrderLines(
    [
      { orderId: 'o1', socialAccountId: 'acc_ig', sentAt: '2026-09-01T10:00:00Z' },
      { orderId: 'o1', socialAccountId: 'acc_wa', sentAt: '2026-09-02T10:00:00Z' },
      { orderId: 'o2', socialAccountId: 'acc_gone', sentAt: '2026-09-02T10:00:00Z' },
      { orderId: null, socialAccountId: 'acc_wa', sentAt: '2026-09-02T10:00:00Z' },
    ],
    accounts,
  )
  assert.deepEqual(Object.keys(lines), ['o1'])
  assert.equal(lines.o1.socialAccountId, 'acc_wa')
  assert.equal(lines.o1.title, 'PatchHouse CR')
  assert.equal(lines.o1.detail, '+50688887777')
  assert.equal(lines.o1.platform, 'whatsapp')
})

test('pickOrderLines: instagram line shows the @handle', () => {
  const lines = pickOrderLines([{ orderId: 'o9', socialAccountId: 'acc_ig', sentAt: new Date() }], accounts)
  assert.equal(lines.o9.platform, 'instagram')
  assert.match(lines.o9.title, /patchhouse/)
})

test('canalLabel: a real line wins over salesChannel', () => {
  const lines = pickOrderLines([{ orderId: 'o1', socialAccountId: 'acc_wa', sentAt: new Date() }], accounts)
  const label = canalLabel({ salesChannel: 'Instagram' }, lines.o1)
  assert.equal(label.label, 'PatchHouse CR')
  assert.equal(label.hasLine, true)
  assert.equal(label.family, 'whatsapp')
})

test('canalLabel: WhatsApp / Instagram without a line are never bare', () => {
  assert.equal(canalLabel({ salesChannel: 'WhatsApp' }).label, 'WhatsApp · sin línea')
  assert.equal(canalLabel({ salesChannel: 'instagram' }).label, 'Instagram · sin línea')
  assert.equal(canalLabel({ funnel: 'wa' }).label, 'WhatsApp · sin línea')
})

test('canalLabel: other values as-is, empty -> Manual', () => {
  assert.equal(canalLabel({ salesChannel: 'Facebook' }).label, 'Facebook')
  assert.equal(canalLabel({ salesChannel: 'Referido' }).label, 'Referido')
  assert.equal(canalLabel({}).label, 'Manual')
  assert.equal(canalLabel({ salesChannel: '  ', funnel: '' }).label, 'Manual')
})

test('canalLabel never returns exactly "WhatsApp" or "Instagram"', () => {
  const inputs = ['WhatsApp', 'whatsapp', 'WA', 'wa', 'Instagram', 'ig', 'IG', 'Facebook', '', 'x']
  for (const salesChannel of inputs) {
    const { label } = canalLabel({ salesChannel })
    assert.notEqual(label, 'WhatsApp')
    assert.notEqual(label, 'Instagram')
  }
})

test('filterByLine / distinctLines', () => {
  const lines = pickOrderLines(
    [
      { orderId: 'o1', socialAccountId: 'acc_wa', sentAt: new Date() },
      { orderId: 'o2', socialAccountId: 'acc_ig', sentAt: new Date() },
    ],
    accounts,
  )
  const rows = [
    { id: 'o1', orderId: 'PH-1' },
    { id: 'o2', orderId: 'PH-2' },
    { id: 'o3', orderId: 'PH-3' },
  ]
  assert.equal(filterByLine(rows, lines, LINE_FILTER_ALL).length, 3)
  assert.deepEqual(filterByLine(rows, lines, 'acc_wa').map((r) => r.id), ['o1'])
  assert.deepEqual(filterByLine(rows, lines, LINE_FILTER_MANUAL).map((r) => r.id), ['o3'])
  assert.equal(distinctLines(lines).length, 2)
})

test('GET /api/orders/lines: view_sales, tenant-scoped, capped at 200 ids, read-only', () => {
  const src = read('src/app/api/orders/lines/route.ts')
  assert.match(src, /authenticateAPIWithPermission\(request, 'view_sales'\)/)
  assert.match(src, /MAX_IDS = 200/)
  assert.match(src, /chatMessage\.findMany\(\{\s*where: \{ tenantId,/)
  assert.match(src, /socialAccount\.findMany\(\{\s*where: \{ tenantId,/)
  assert.doesNotMatch(src, /\.(create|update|updateMany|delete|deleteMany|upsert)\(/)
  assert.doesNotMatch(src, /process\.env/)
})
