/** Login gates + password reset hardening (security, 2026-09-28). No DB, no network. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  LOCKOUT,
  clearLoginFailures,
  clientIpFromHeaders,
  emailVerificationBlocks,
  isLockedOut,
  loginLocked,
  parseEnforceFrom,
  recordLoginFailure,
} from '../auth-gates'
import { escapeHtml, generateResetToken, hashResetToken, legacyRawResetToken } from '../password-reset'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
const cutoff = new Date('2026-10-01T00:00:00Z')

test('email verification: off without a cutoff (ships off)', () => {
  assert.equal(emailVerificationBlocks({ emailVerified: null, createdAt: new Date() }, null), false)
  assert.equal(parseEnforceFrom(undefined), null)
  assert.equal(parseEnforceFrom('  '), null)
  assert.equal(parseEnforceFrom('not a date'), null)
})

test('email verification: existing unverified users (created before the cutoff) are grandfathered', () => {
  assert.equal(emailVerificationBlocks({ emailVerified: null, createdAt: new Date('2025-01-01') }, cutoff), false)
  assert.equal(emailVerificationBlocks({ emailVerified: null, createdAt: null }, cutoff), false, 'unknown date = existing')
})

test('email verification: new unverified accounts are blocked; verified ones pass', () => {
  assert.equal(emailVerificationBlocks({ emailVerified: null, createdAt: new Date('2026-10-02') }, cutoff), true)
  assert.equal(emailVerificationBlocks({ emailVerified: null, createdAt: cutoff }, cutoff), true)
  assert.equal(emailVerificationBlocks({ emailVerified: new Date(), createdAt: new Date('2026-10-02') }, cutoff), false)
})

test('lockout thresholds', () => {
  assert.equal(isLockedOut({ emailIp: LOCKOUT.emailIpMax - 1, ip: 0 }), false)
  assert.equal(isLockedOut({ emailIp: LOCKOUT.emailIpMax, ip: 0 }), true)
  assert.equal(isLockedOut({ emailIp: 0, ip: LOCKOUT.ipMax - 1 }), false)
  assert.equal(isLockedOut({ emailIp: 0, ip: LOCKOUT.ipMax }), true)
})

test('lockout: email+IP locks after 5 failures, other IPs unaffected (no owner lockout), success clears', async () => {
  const email = `victim-${Date.now()}@x.cr`
  for (let i = 0; i < LOCKOUT.emailIpMax; i++) {
    assert.equal(await loginLocked(email, '10.0.0.1'), false, `attempt ${i}`)
    await recordLoginFailure(email, '10.0.0.1')
  }
  assert.equal(await loginLocked(email, '10.0.0.1'), true)
  assert.equal(await loginLocked(email, '10.0.0.2'), false, 'the real owner on another network still gets in')
  assert.equal(await loginLocked(email.toUpperCase(), '10.0.0.1'), true, 'case-insensitive')
  await clearLoginFailures(email, '10.0.0.1')
  assert.equal(await loginLocked(email, '10.0.0.1'), false)
})

test('lockout: unknown emails count too, and one IP spraying many emails is capped', async () => {
  const ip = `10.9.${Date.now() % 250}.7`
  for (let i = 0; i < LOCKOUT.ipMax; i++) await recordLoginFailure(`nobody-${i}@x.cr`, ip)
  assert.equal(await loginLocked('someone-else@x.cr', ip), true)
})

test('lockout kill switch', async () => {
  const email = `ks-${Date.now()}@x.cr`
  for (let i = 0; i < LOCKOUT.emailIpMax; i++) await recordLoginFailure(email, '10.1.1.1')
  process.env.AUTH_LOCKOUT_DISABLED = '1'
  try {
    assert.equal(await loginLocked(email, '10.1.1.1'), false)
  } finally {
    delete process.env.AUTH_LOCKOUT_DISABLED
  }
})

test('client IP from NextAuth plain headers honours TRUSTED_IP_HEADER', () => {
  assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }), '1.2.3.4')
  assert.equal(clientIpFromHeaders({}), 'unknown')
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  try {
    assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '1.2.3.4' }), '1.2.3.4')
    assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '6.6.6.6' }), 'trusted-header-missing')
  } finally {
    delete process.env.TRUSTED_IP_HEADER
  }
})

test('authorize wiring: lock before lookup, burn bcrypt for unknown, verification after password', () => {
  const src = read('src/lib/auth-options.ts')
  const body = src.split('async authorize(credentials, req)')[1].split('GoogleProvider(')[0]
  const at = (s: string) => {
    const i = body.indexOf(s)
    assert.ok(i >= 0, s)
    return i
  }
  assert.ok(at('loginLocked(') < at('prisma.user.findFirst'))
  assert.ok(at('burnPasswordCheck(password)') < at('verifyPassword(password'))
  assert.ok(at('verifyPassword(password') < at('emailVerificationBlocks(user)'))
  assert.match(body, /Object\.values\(LOGIN_ERRORS\)[^\n]*includes\(error\.message\)\)\s*\{\s*throw error/)
  assert.doesNotMatch(body, /rateLimit\(`credentials:/, 'old per-email lock (owner-lockout vector) removed')
})

test('reset tokens: random, hashed at rest, legacy raw only for UUID shape', () => {
  const t = generateResetToken()
  assert.match(t, /^[0-9a-f]{64}$/)
  assert.notEqual(generateResetToken(), t)
  assert.match(hashResetToken(t), /^[0-9a-f]{64}$/)
  assert.notEqual(hashResetToken(t), t)
  assert.equal(legacyRawResetToken('3b241101-e2bb-4255-8caf-4136c566a962'), '3b241101-e2bb-4255-8caf-4136c566a962')
  assert.equal(legacyRawResetToken(hashResetToken(t)), null, 'a stolen hash is never compared raw')
})

test('reset routes: hash stored, single atomic consume, escaped name, inactive refused', () => {
  const forgot = read('src/app/api/auth/forgot-password/route.ts')
  assert.match(forgot, /"passwordResetToken" = \$\{hashResetToken\(token\)\}/)
  assert.match(forgot, /escapeHtml\(user\.name/)
  assert.match(forgot, /!user \|\| user\.active === false/)
  const reset = read('src/app/api/auth/reset-password/route.ts')
  assert.doesNotMatch(reset, /SELECT id, email FROM "User"/, 'no read-then-write')
  assert.match(reset, /UPDATE "User"[\s\S]*"passwordResetToken" = NULL[\s\S]*AND active = true\s*RETURNING id, email/)
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
})
