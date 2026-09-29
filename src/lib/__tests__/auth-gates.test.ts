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
  ipBucket,
  isLockedOut,
  parseEnforceFrom,
  releaseLoginAttempt,
  reserveLoginAttempt,
} from '../auth-gates'
import { escapeHtml, generateResetToken, hashResetToken, legacyRawResetToken } from '../password-reset'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')
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

test('lockout thresholds (counts include the attempt being made)', () => {
  assert.equal(isLockedOut({ emailIp: LOCKOUT.emailIpMax, ip: 0 }), false)
  assert.equal(isLockedOut({ emailIp: LOCKOUT.emailIpMax + 1, ip: 0 }), true)
  assert.equal(isLockedOut({ emailIp: 0, ip: LOCKOUT.ipMax + 1 }), true)
  assert.equal(isLockedOut({ emailIp: 0, ip: 0, email: LOCKOUT.emailMax + 1 }), true)
})

test('lockout: 5 wrong guesses per email+IP, other IPs unaffected, a correct login gives the attempt back', async () => {
  const email = `victim-${Date.now()}@x.cr`
  for (let i = 0; i < LOCKOUT.emailIpMax; i++) {
    assert.equal((await reserveLoginAttempt(email, '10.0.0.1')).locked, false, `attempt ${i}`)
  }
  assert.equal((await reserveLoginAttempt(email, '10.0.0.1')).locked, true)
  assert.equal((await reserveLoginAttempt(email.toUpperCase(), '10.0.0.1')).locked, true, 'case-insensitive')
  assert.equal((await reserveLoginAttempt(email, '10.0.0.2')).locked, false, 'the real owner elsewhere still gets in')
  // A correct login from .2 releases its attempt; the email+IP counter for .2 is cleared.
  await releaseLoginAttempt(email, '10.0.0.2')
})

test('lockout: parallel guesses cannot all slip through (reserve is atomic)', async () => {
  const email = `race-${Date.now()}@x.cr`
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveLoginAttempt(email, '10.7.7.7')))
  assert.equal(results.filter((r) => !r.locked).length, LOCKOUT.emailIpMax)
})

test('lockout: one IP spraying many emails is capped; one email across many IPs is capped', async () => {
  const ip = `10.9.${Date.now() % 250}.7`
  let last = { locked: false }
  for (let i = 0; i <= LOCKOUT.ipMax; i++) last = await reserveLoginAttempt(`nobody-${i}-${Date.now()}@x.cr`, ip)
  assert.equal(last.locked, true)
  const email = `botnet-${Date.now()}@x.cr`
  for (let i = 0; i <= LOCKOUT.emailMax; i++) last = await reserveLoginAttempt(email, `172.16.${i % 250}.${i}`)
  assert.equal(last.locked, true)
  await clearLoginFailures(email)
  assert.equal((await reserveLoginAttempt(email, '172.17.0.1')).locked, false, 'a password reset clears the account cap')
})

test('IPv6 is bucketed by /48 for the IP counter', () => {
  assert.equal(ipBucket('2001:db8:1:2::/64'), '2001:db8:1::/48')
  assert.equal(ipBucket('1.2.3.4'), '1.2.3.4')
})

test('lockout kill switch', async () => {
  const email = `ks-${Date.now()}@x.cr`
  for (let i = 0; i <= LOCKOUT.emailIpMax; i++) await reserveLoginAttempt(email, '10.1.1.1')
  process.env.AUTH_LOCKOUT_DISABLED = '1'
  try {
    assert.equal((await reserveLoginAttempt(email, '10.1.1.1')).locked, false)
  } finally {
    delete process.env.AUTH_LOCKOUT_DISABLED
  }
})

test('client IP from NextAuth plain headers: right-most X-Forwarded-For hop, or TRUSTED_IP_HEADER', () => {
  assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '6.6.6.6, 5.6.7.8' }), '5.6.7.8', 'the client-chosen first hop is ignored')
  assert.equal(clientIpFromHeaders({}), 'unknown')
  process.env.TRUSTED_IP_HEADER = 'cf-connecting-ip'
  try {
    assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '6.6.6.6', 'cf-connecting-ip': '1.2.3.4' }), '1.2.3.4')
    assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '6.6.6.6' }), 'trusted-header-missing')
  } finally {
    delete process.env.TRUSTED_IP_HEADER
  }
})

test('authorize wiring: reserve before lookup, exact lookup, equal timing, version read before password', () => {
  const src = read('src/lib/auth-options.ts')
  const body = src.split('async authorize(credentials, req)')[1].split('GoogleProvider(')[0]
  const at = (s: string) => {
    const i = body.indexOf(s)
    assert.ok(i >= 0, s)
    return i
  }
  assert.ok(at('reserveLoginAttempt(') < at('findUserIdByEmail('))
  assert.doesNotMatch(body, /mode: 'insensitive'/, 'no ILIKE lookup')
  assert.match(body, /!user \|\| !user\.active \|\| !user\.password \|\| !isBcryptHash\(user\.password\)\) \{[\s\S]{0,200}burnPasswordCheck\(password\)/)
  assert.ok(at('loadUserAuthState(userId)') < at('prisma.user.findUnique'), 'version read before the password hash (AUTH-12)')
  assert.ok(at('verifyPassword(password') < at('emailVerificationBlocks(user)'))
  assert.ok(at('emailVerificationBlocks(user)') < at('releaseLoginAttempt('))
  assert.match(body, /sv: sessionVersion,/)
  assert.match(body, /Object\.values\(LOGIN_ERRORS\)[^\n]*includes\(error\.message\)\)\s*\{\s*throw error/)
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
  // One statement also ends every session; the email is verified only in that statement (H3/M1).
  const primary = reset.split('async function consumeResetLink')[1].split('} catch (error)')[0]
  assert.match(primary, /"emailVerified" = COALESCE\("emailVerified", NOW\(\)\)/)
  assert.match(primary, /"sessionVersion" = "sessionVersion" \+ 1/)
  const fallback = reset.split('} catch (error)')[1].split('export async function POST')[0]
  assert.doesNotMatch(fallback, /emailVerified/, 'pre-034 fallback never verifies (sessions could not be ended)')
  assert.ok(reset.indexOf('const live = await prisma.$queryRaw') < reset.indexOf('await hashPassword(password)'), 'no bcrypt for dead links')
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
})

test('a caller blocked by its own buckets does not spend the account budget (AUTH-27)', async () => {
  const email = `target-${Date.now()}@x.cr`
  // One IP hammering one email: its email+IP bucket locks after 5, the account budget stays low.
  for (let i = 0; i < 100; i++) await reserveLoginAttempt(email, '10.66.66.66')
  assert.equal((await reserveLoginAttempt(email, '10.77.0.1')).locked, false, 'the owner on another network still gets in')
})

test('EMAIL_NOT_VERIFIED gives the attempt back (right password is not a failure)', () => {
  const src = read('src/lib/auth-options.ts')
  assert.match(src, /if \(emailVerificationBlocks\(user\)\) \{[\s\S]{0,200}await releaseLoginAttempt\(normalizedEmail, ip\)\s*throw new Error\(LOGIN_ERRORS\.emailNotVerified\)/)
})
