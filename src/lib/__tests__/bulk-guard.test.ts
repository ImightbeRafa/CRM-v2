/** AUTH-07 (Critical, 2026-09-29): bulk endpoints must never write the global User table. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { refuseUnsafeBulk, sanitizeUpdates } from '../bulkOperations'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('users are refused, and nothing runs without a tenant', () => {
  assert.equal(refuseUnsafeBulk('users', 't1', 2)?.failed, 2)
  assert.equal(refuseUnsafeBulk('orders', undefined, 1)?.failed, 1)
  assert.equal(refuseUnsafeBulk('orders', 't1', 1), null)
})

test('updates cannot move rows between businesses or write relations', () => {
  const out = sanitizeUpdates({ tenantId: 'x', optionSetId: 'y', id: 'z', password: 'h', nested: { a: 1 }, status: ' ok ', active: false }, 'orders')
  assert.deepEqual(out, { password: 'h', status: 'ok', active: false })
})

test('routes no longer accept type users; library refuses first; options scoped', () => {
  for (const r of ['delete', 'update', 'toggle-active']) {
    assert.doesNotMatch(read(`src/app/api/bulk/${r}/route.ts`), /validTypes = \[[^\]]*'users'/, r)
  }
  const lib = read('src/lib/bulkOperations.ts')
  assert.equal((lib.match(/const refused = refuseUnsafeBulk\(type, tenantId, ids\.length\)/g) || []).length, 2)
  assert.doesNotMatch(lib, /productOption\.updateMany\(\{\s*where: \{ id: \{ in: ids \} \}/)
})
