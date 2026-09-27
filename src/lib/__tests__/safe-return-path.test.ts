import test from 'node:test'
import assert from 'node:assert/strict'
import { safeReturnPath, DEFAULT_RETURN_PATH } from '../safe-return-path'

const FB = DEFAULT_RETURN_PATH

test('empty / non-string inputs fall back', () => {
  for (const v of [null, undefined, '', '   ', 42, {}, []]) {
    assert.equal(safeReturnPath(v), FB)
  }
})

test('same-origin relative paths are kept as-is', () => {
  for (const v of ['/ventas?pedido=PH-1', '/config?tab=social#x', '/dashboard', '/chats', '/ventas?nuevo=1']) {
    assert.equal(safeReturnPath(v), v)
  }
})

test('protocol-relative and backslash forms are rejected', () => {
  for (const v of ['//evil.com', '///evil.com', '/\\evil.com', '\\\\evil.com', '/\\/evil.com']) {
    assert.equal(safeReturnPath(v), FB, v)
  }
})

test('percent-encoded (and double-encoded) bypasses are rejected', () => {
  for (const v of ['/%2F%2Fevil.com', '%2F%2Fevil.com', '/%5Cevil.com', '/%252F%252Fevil.com', '/%25252F%25252Fevil.com']) {
    assert.equal(safeReturnPath(v), FB, v)
  }
})

test('absolute URLs and schemes are rejected', () => {
  for (const v of [
    'https://evil.com',
    'http:evil.com',
    'HTTPS://evil.com',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '/javascript:alert(1)',
    '%6A%61vascript:alert(1)',
    'data:text/html,x',
    'ftp://evil.com/x',
  ]) {
    assert.equal(safeReturnPath(v), FB, v)
  }
})

test('dot-segment and control-character tricks are rejected', () => {
  for (const v of ['/..//evil.com', '/./\\evil.com', '/\tevil', '/a\nb', '/a\u0000b', '/%0d%0aLocation:x']) {
    assert.equal(safeReturnPath(v), FB, v)
  }
})

test('auth / api / _next paths are rejected (redirect loops, non-pages)', () => {
  for (const v of ['/auth/signin?callbackUrl=/x', '/api/users', '/_next/static/x.js', '/auth', '/AUTH/signin', '/%61uth/signin']) {
    assert.equal(safeReturnPath(v), FB, v)
  }
  // Similar-looking but legitimate pages stay allowed.
  assert.equal(safeReturnPath('/authors'), '/authors')
})

test('absolute URL of the same origin is reduced to its path', () => {
  const origin = 'https://app.test'
  assert.equal(safeReturnPath('https://app.test/ventas?x=1', { origin }), '/ventas?x=1')
  assert.equal(safeReturnPath('https://app.test.evil.com/x', { origin }), FB)
  assert.equal(safeReturnPath('https://evil.com/ventas', { origin }), FB)
  assert.equal(safeReturnPath('https://app.test@evil.com/x', { origin }), FB)
  assert.equal(safeReturnPath('https://app.test/auth/signin', { origin }), FB)
})

test('overlong paths fall back', () => {
  assert.equal(safeReturnPath('/' + 'a'.repeat(3000)), FB)
})

test('custom fallback is used for rejected input', () => {
  assert.equal(safeReturnPath('//evil.com', { fallback: '/chats' }), '/chats')
  assert.equal(safeReturnPath(null, { fallback: '/chats' }), '/chats')
  assert.equal(safeReturnPath('/ventas', { fallback: '/chats' }), '/ventas')
})
