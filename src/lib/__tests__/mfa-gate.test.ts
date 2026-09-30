import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  holdTokenForMfa,
  isAllowedDuringMfa,
  isMfaPendingToken,
  isSessionReadingPublicRoute,
  pendingMfaNonce,
  pendingMfaUserId,
  resolvePendingMfa,
  revokedMfaToken,
  safeMfaCallback,
} from '../mfa-session'

const FULL = {
  sub: 'user-1',
  id: 'user-1',
  email: 'owner@x.test',
  name: 'Owner',
  tenantId: 'tenant-1',
  role: 'MASTER',
  memberships: [{ tenantId: 'tenant-1', role: 'OWNER' }],
  currentTenant: { id: 'tenant-1', role: 'OWNER' },
  allTenantIds: ['tenant-1'],
  isLogisticsAdmin: true,
  sv: 3,
  iat: 1,
  exp: 2,
  jti: 'j',
}

test('a pending session carries NO user, business, role or email at the top level', () => {
  const pending = holdTokenForMfa(FULL, 'nonce-1', Date.now() + 60_000)
  assert.equal(isMfaPendingToken(pending), true)
  for (const claim of ['sub', 'id', 'email', 'name', 'tenantId', 'role', 'memberships', 'currentTenant', 'allTenantIds', 'isLogisticsAdmin', 'sv']) {
    assert.equal(claim in pending, false, `${claim} leaked into the pending token`)
  }
  assert.equal(pendingMfaUserId(pending), 'user-1')
  assert.equal(pendingMfaNonce(pending), 'nonce-1')
  // NextAuth-managed claims are not held (re-set on every encode).
  const held = pending.mfaHeld as Record<string, unknown>
  assert.equal('iat' in held || 'exp' in held || 'jti' in held, false)
  assert.equal(pendingMfaUserId(FULL), null)
  assert.equal(pendingMfaNonce({ mfa: 'ok', mfaNonce: 'x' }), null)
})

test('pending → stays pending without an explicit update or without a verified challenge', async () => {
  const pending = holdTokenForMfa(FULL, 'nonce-1', 10_000)
  let calls = 0
  const consume = async () => {
    calls += 1
    return false
  }
  assert.deepEqual(await resolvePendingMfa(pending, undefined, { consume, now: 1_000 }), { kind: 'stay' })
  assert.equal(calls, 0, 'a plain session read must never try to upgrade')
  assert.deepEqual(await resolvePendingMfa(pending, 'update', { consume, now: 1_000 }), { kind: 'stay' })
  assert.equal(calls, 1)
  // A DB hiccup keeps it pending (never upgrades on error).
  const boom = async () => {
    throw new Error('db down')
  }
  assert.deepEqual(await resolvePendingMfa(pending, 'update', { consume: boom, now: 1_000 }), { kind: 'stay' })
})

test('pending → upgrades only with a consumed challenge for the held user + nonce, and forces a re-sync', async () => {
  const pending = holdTokenForMfa(FULL, 'nonce-1', 10_000)
  const seen: string[] = []
  const r = await resolvePendingMfa(pending, 'update', {
    consume: async (userId, nonce) => {
      seen.push(`${userId}:${nonce}`)
      return true
    },
    now: 1_000,
  })
  assert.equal(r.kind, 'upgraded')
  assert.deepEqual(seen, ['user-1:nonce-1'])
  const token = (r as { token: Record<string, unknown> }).token
  assert.equal(token.id, 'user-1')
  assert.equal(token.tenantId, 'tenant-1')
  assert.equal(token.lastDbSync, 0)
  assert.equal(isMfaPendingToken(token), false)
  assert.equal('mfaHeld' in token || 'mfaNonce' in token, false)
})

test('pending → dead session once the 10 min window passes, or when the token is malformed', async () => {
  const consume = async () => true
  const expired = holdTokenForMfa(FULL, 'nonce-1', 5_000)
  assert.deepEqual(await resolvePendingMfa(expired, 'update', { consume, now: 5_000 }), { kind: 'revoked', token: revokedMfaToken() })
  for (const bad of [
    { mfa: 'pending', mfaNonce: 'n', mfaUntil: 9e15 }, // no held user
    { mfa: 'pending', mfaHeld: { id: 'u' }, mfaUntil: 9e15 }, // no nonce
    { mfa: 'pending', mfaHeld: { id: 'u' }, mfaNonce: 'n' }, // no expiry
  ]) {
    assert.equal((await resolvePendingMfa(bad, 'update', { consume, now: 1 })).kind, 'revoked')
  }
  assert.deepEqual(revokedMfaToken(), { error: 'session_revoked', active: false })
})

test('only the code page, the verify API and NextAuth core answer a pending session', () => {
  for (const ok of [
    '/auth/2fa',
    '/api/auth/2fa/verify',
    '/api/auth/session',
    '/api/auth/csrf',
    '/api/auth/signout',
    '/api/auth/providers',
    '/api/auth/signin',
    '/api/auth/signin/google',
    '/api/auth/callback/google',
    '/api/auth/callback/credentials',
  ]) {
    assert.equal(isAllowedDuringMfa(ok), true, ok)
  }
  for (const no of [
    '/api/auth/me',
    '/api/auth/send-phone-otp',
    '/api/auth/verify-phone-otp',
    '/api/auth/whatsapp/direct-oauth',
    '/api/auth/instagram/auth-url',
    '/api/auth/register',
    '/api/auth/sessionx',
    '/api/auth/2faX',
    '/api/invites/accept',
    '/dashboard',
    '/api/chat/conversations',
    '/auth/2fa/../dashboard',
  ]) {
    assert.equal(isAllowedDuringMfa(no), false, no)
  }
  assert.equal(isSessionReadingPublicRoute('/api/auth/me'), true)
  assert.equal(isSessionReadingPublicRoute('/api/invites/accept'), true)
  assert.equal(isSessionReadingPublicRoute('/api/chat/webhook'), false)
})

test('the return path after the code is same-origin only', () => {
  assert.equal(safeMfaCallback('/chats?x=1'), '/chats?x=1')
  assert.equal(safeMfaCallback('https://app.test/chats', 'https://app.test'), '/chats')
  assert.equal(safeMfaCallback('https://evil.test/chats', 'https://app.test'), '/dashboard')
  // AUTH-47: control characters the browser strips (/\t/evil.com -> //evil.com) and encoded tricks.
  for (const bad of ['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '', null, undefined, '/api/users', '/auth/2fa?x', '/\t/evil.test', '/\n/evil.test', '/\r/evil.test', '/%09/evil.test', '/%2F%2Fevil.test']) {
    assert.equal(safeMfaCallback(bad as string), '/dashboard', String(bad))
  }
})

test('wiring: jwt gate fails closed, session exposes nothing while pending, middleware blocks first', () => {
  const auth = readFileSync('src/lib/auth-options.ts', 'utf8')
  const jwt = auth.slice(auth.indexOf('    async jwt(params) {'), auth.indexOf('    async session({ session, token }) {'))
  assert.match(jwt, /if \(!user && isMfaPendingToken\(token\)\)/)
  assert.match(jwt, /consume: consumeVerifiedMfaChallenge/)
  assert.match(jwt, /isMfaEnabled\(signedInId\)/)
  assert.match(jwt, /catch \(error\) \{[\s\S]*?return revokedMfaToken\('mfa_unavailable'\) as JWT/)
  const session = auth.slice(auth.indexOf('    async session({ session, token }) {'))
  assert.match(session, /^    async session\(\{ session, token \}\) \{\s*\/\/[^\n]*\n\s*if \(isMfaPendingToken\(token\)\) \{\s*return \{ expires: session\.expires, mfa: 'pending' \}/)

  const mw = readFileSync('src/middleware.ts', 'utf8')
  const pendingCheck = mw.indexOf('if (isMfaPendingToken(token)) {')
  assert.ok(pendingCheck > 0 && pendingCheck < mw.indexOf('await setSignedAuthHeaders('), 'pending check must run before signed context headers are set')
  assert.ok(pendingCheck < mw.indexOf("const tokenError = (token as { error?: string }).error;"))
  const publicGate = mw.indexOf('isSessionReadingPublicRoute(pathname) && !isAllowedDuringMfa(pathname)')
  assert.ok(publicGate > 0 && publicGate < mw.indexOf("if (pathname === '/' || isPublicRoute(pathname))"))
})

test('2FA routes never read the user from the request body', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'route.ts') files.push(p)
    }
  }
  walk('src/app/api/account/2fa')
  walk('src/app/api/auth/2fa')
  assert.equal(files.length, 6)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    assert.doesNotMatch(src, /body\??\.(userId|user|email|id)\b/, f)
    if (f.includes('account')) assert.match(src, /authenticateUserOnly\(request\)/, f)
    else assert.match(src, /pendingMfaUserId\(token\)/, f)
    assert.match(src, /PII_NO_STORE_HEADERS|mfaReply/, f)
  }
})

test('SecureDog round 1 fixes are wired (AUTH-43/44/48/49/50/51)', () => {
  const state = readFileSync('src/lib/mfa-state.ts', 'utf8')
  // AUTH-43: one conditional UPDATE reserves a guess BEFORE any check (no check-then-act).
  const reserve = state.slice(state.indexOf('export async function reserveMfaAttempt'), state.indexOf('async function refundMfaAttempts'))
  assert.match(reserve, /UPDATE "UserTwoFactor" SET[\s\S]*"failCount" < \$\{MFA_WINDOW_LIMIT\}[\s\S]*"dayFailCount" < \$\{MFA_DAY_LIMIT\}/)
  const verify = state.slice(state.indexOf('export async function verifyMfaChallenge'), state.indexOf('async function checkFactor'))
  assert.ok(verify.indexOf('reserveMfaAttempt(') < verify.indexOf('checkFactor('), 'budget reserved before the code is checked')
  const current = state.slice(state.indexOf('export async function verifyCurrentFactor'))
  assert.ok(current.indexOf('reserveMfaAttempt(') < current.indexOf('checkFactor('))
  const setup = state.slice(state.indexOf('export async function completeMfaSetup'))
  assert.ok(setup.indexOf('reserveMfaAttempt(') < setup.indexOf('verifyTotp('))
  // Only the newest challenge is live; expired rows go.
  const create = state.slice(state.indexOf('export async function createMfaChallenge'), state.indexOf('export type MfaVerifyResult'))
  assert.match(create, /deleteMany\(\{ where: \{ userId, expiresAt: \{ lte: nowDate \} \} \}\)/)
  assert.match(create, /updateMany\(\{\s*where: \{ userId, consumedAt: null, verifiedAt: null, expiresAt: \{ gt: nowDate \} \},\s*data: \{ expiresAt: nowDate \}/)
  // AUTH-50: an already verified (unconsumed) challenge answers success again.
  assert.match(verify, /verifiedAt: \{ not: null \}, consumedAt: null[\s\S]*method: 'already_verified'/)
  // AUTH-48: missing tables fail closed once MFA_TABLES_REQUIRED=1.
  assert.match(state, /process\.env\.MFA_TABLES_REQUIRED === '1'/)
  // Only a verified mailbox can enrol.
  assert.match(state, /if \(!owner\?\.emailVerified\) return \{ error: 'email_unverified' \}/)

  // Routes: IP slot reserved before the check, never the old check-then-act helpers.
  const verifyRoute = readFileSync('src/app/api/auth/2fa/verify/route.ts', 'utf8')
  assert.ok(verifyRoute.indexOf('reserveMfaIpSlot(') < verifyRoute.indexOf('verifyMfaChallenge({'))
  assert.doesNotMatch(verifyRoute, /mfaThrottled|recordMfaFailure/)
  // AUTH-44: setup and disable need the password (or a fresh Google sign-in).
  for (const f of ['setup', 'disable']) {
    assert.match(readFileSync(`src/app/api/account/2fa/${f}/route.ts`, 'utf8'), /proveAccountOwner\(request, auth\.userId, body\?\.password\)/, f)
  }
  const account = readFileSync('src/lib/mfa-account.ts', 'utf8')
  assert.match(account, /FRESH_SIGN_IN_MS = 15 \* 60_000/)
  assert.match(account, /Date\.now\(\) - authAt > FRESH_SIGN_IN_MS/)
  // AUTH-50: once enabled / disabled, a follow-up hiccup never turns into an error answer.
  const enable = readFileSync('src/app/api/account/2fa/enable/route.ts', 'utf8')
  assert.match(enable, /try \{\s*await revokeUserSessions\(auth\.userId\)\s*\} catch \{\s*sessionsEnded = false/)

  const auth = readFileSync('src/lib/auth-options.ts', 'utf8')
  // AUTH-49: invites wait for the code step for 2FA users.
  assert.match(auth, /if \(pending && !\(await mfaOnOrUnknown\(user\.id\)\)\)/)
  assert.match(auth, /decision === 'join_invite' && pending && !deferInviteFor2fa/)
  assert.match(auth, /\(next as \{ authAt\?: number \}\)\.authAt = Date\.now\(\)/)

  const mw = readFileSync('src/middleware.ts', 'utf8')
  assert.match(mw, /tokenError === 'mfa_unavailable'/)
  assert.match(mw, /!tenantId && \(pathname === '\/api\/account\/2fa' \|\| pathname\.startsWith\('\/api\/account\/2fa\/'\)\)/)
  // AUTH-51: nightly purge of finished challenges.
  assert.match(readFileSync('src/app/api/cron/workspace-retention/route.ts', 'utf8'), /purgeOldMfaChallenges\(\)/)
})
