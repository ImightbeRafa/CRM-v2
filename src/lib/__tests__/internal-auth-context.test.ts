import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  AUTH_CONTEXT_SIG_HEADER,
  INTERNAL_AUTH_HEADERS,
  canonicalAuthContext,
  readVerifiedAuthContext,
  setSignedAuthHeaders,
  signAuthContext,
} from '../internal-auth-context'

const SECRET = 'test-nextauth-secret-0123456789'
const ctx = { userId: 'user_1', tenantId: 'tenant_A', role: 'ADMIN', email: 'a@b.cr', sv: 3 }

test('middleware-signed context is accepted', async () => {
  const h = new Headers()
  await setSignedAuthHeaders(h, ctx, SECRET)
  assert.deepEqual(await readVerifiedAuthContext(h, SECRET), ctx)
})

test('forged headers without a signature are rejected (the /api/x.png spoof)', async () => {
  const h = new Headers({ 'x-user-id': 'user_1', 'x-tenant-id': 'tenant_A', 'x-user-role': 'OWNER' })
  assert.equal(await readVerifiedAuthContext(h, SECRET), null)
})

test('a garbage or wrong-length signature is rejected', async () => {
  for (const sig of ['nope', '0'.repeat(64), 'ZZ'.repeat(32), '0'.repeat(63)]) {
    const h = new Headers({ 'x-user-id': 'user_1', 'x-user-role': 'OWNER', [AUTH_CONTEXT_SIG_HEADER]: sig })
    assert.equal(await readVerifiedAuthContext(h, SECRET), null, sig)
  }
})

test('changing any signed value after signing is rejected', async () => {
  for (const [name, value] of [['x-tenant-id', 'tenant_B'], ['x-user-role', 'OWNER'], ['x-user-id', 'user_2'], ['x-user-email', 'x@y.cr'], ['x-betsy-sv', '0']]) {
    const h = new Headers()
    await setSignedAuthHeaders(h, ctx, SECRET)
    h.set(name, value)
    assert.equal(await readVerifiedAuthContext(h, SECRET), null, name)
  }
  const dropped = new Headers()
  await setSignedAuthHeaders(dropped, ctx, SECRET)
  dropped.delete('x-tenant-id')
  assert.equal(await readVerifiedAuthContext(dropped, SECRET), null, 'dropping the tenant')
})

test('a signature from another secret is rejected', async () => {
  const h = new Headers()
  await setSignedAuthHeaders(h, ctx, 'some-other-secret')
  assert.equal(await readVerifiedAuthContext(h, SECRET), null)
})

test('no secret: nothing is set and nothing is trusted (falls back to the session check)', async () => {
  const h = new Headers({ 'x-user-id': 'spoof' })
  await setSignedAuthHeaders(h, ctx, '')
  assert.equal(h.get('x-user-id'), null, 'stale headers are cleared')
  assert.equal(await signAuthContext(ctx, ''), null)
  assert.equal(await readVerifiedAuthContext(h, ''), null)
})

test('the signed string is unambiguous across field boundaries', () => {
  const a = canonicalAuthContext({ userId: 'a|b', tenantId: 'c', role: 'R', email: null, sv: 0 })
  const b = canonicalAuthContext({ userId: 'a', tenantId: 'b|c', role: 'R', email: null, sv: 0 })
  assert.notEqual(a, b)
})

test('context without a tenant still verifies (tenant-less setup users)', async () => {
  const h = new Headers()
  const noTenant = { ...ctx, tenantId: null, email: null }
  await setSignedAuthHeaders(h, noTenant, SECRET)
  assert.deepEqual(await readVerifiedAuthContext(h, SECRET), noTenant)
})

const root = process.cwd()

test('middleware runs on every /api path and strips every internal header', () => {
  const src = readFileSync(path.join(root, 'src/middleware.ts'), 'utf8')
  assert.match(src, /'\/api\/:path\*'/, 'matcher must include /api/:path* (image-extension gap)')
  assert.match(src, /for \(const name of INTERNAL_AUTH_HEADERS\) sanitizedHeaders\.delete\(name\)/)
  assert.doesNotMatch(src, /requestHeaders\.set\('x-user-id'/, 'context headers only via setSignedAuthHeaders')
})

test('the CF worker strips the signature header too', () => {
  const src = readFileSync(path.join(root, 'src/cf-container-worker.ts'), 'utf8')
  for (const name of INTERNAL_AUTH_HEADERS) assert.ok(src.includes(`"${name}"`), name)
})

test('no handler reads a raw identity header outside the verified helper', () => {
  // Logistics actor / workforce readers are sync and rely on the middleware (which now always
  // runs on /api and strips client values); every tenant/role decision goes through the helper.
  for (const file of ['src/lib/auth-helpers.ts', 'src/lib/apiAuth.ts', 'src/lib/api-tenant.ts', 'src/app/api/audit/export/route.ts', 'src/app/api/import/template/route.ts']) {
    const src = readFileSync(path.join(root, file), 'utf8')
    assert.doesNotMatch(src, /headers\.get\('x-(user-id|user-role|tenant-id)'\)/, file)
  }
})
