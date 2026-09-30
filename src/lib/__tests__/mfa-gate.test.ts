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
  mfaPageForInvite,
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

test('SecureDog rounds 1-2 fixes are wired (AUTH-43/44/48..55)', () => {
  const state = readFileSync('src/lib/mfa-state.ts', 'utf8')
  // AUTH-43: one conditional UPDATE per scope reserves a guess (no check-then-act).
  const reserve = state.slice(state.indexOf('export async function reserveMfaAttempt'), state.indexOf('async function refundMfaAttempt'))
  assert.match(reserve, /"failCount" < \$\{MFA_WINDOW_LIMIT\}[\s\S]*"dayFailCount" < \$\{MFA_DAY_LIMIT\}/)
  // AUTH-53: account changes have their own budget.
  assert.match(reserve, /"mgmtFailCount" < \$\{MFA_MANAGE_LIMIT\}/)
  // AUTH-55 + AUTH-43: TOTP secret decrypted first, then budget, then compare.
  const check = state.slice(state.indexOf('async function checkFactor('), state.indexOf('/** Upgrades the session exactly once'))
  const iDecrypt = check.indexOf('decryptMfaSecretStrict(')
  const iReserve = check.indexOf('reserveMfaAttempt(userId, scope)')
  const iVerify = check.indexOf('verifyTotp(secret')
  assert.ok(iDecrypt > 0 && iDecrypt < iReserve && iReserve < iVerify, 'decrypt → reserve → compare')
  // AUTH-53: recovery codes are never budgeted (a lock can't take the way back in).
  const recoveryBranch = check.slice(check.indexOf('if (input.recoveryCode)'))
  assert.doesNotMatch(recoveryBranch, /reserveMfaAttempt/)
  // Every caller goes through checkFactor with the right scope.
  const verify = state.slice(state.indexOf('export async function verifyMfaChallenge'), state.indexOf('/**\n * Checks a TOTP or recovery code'))
  assert.match(verify, /checkFactor\(args\.userId, \{ code: args\.code, recoveryCode: args\.recoveryCode \}, now, 'signin'\)/)
  assert.match(state, /checkFactor\(userId, input, Date\.now\(\), 'manage'\)/)
  const setup = state.slice(state.indexOf('export async function completeMfaSetup'))
  assert.ok(setup.indexOf('decryptMfaSecretStrict(') < setup.indexOf("reserveMfaAttempt(userId, 'manage')"))
  assert.ok(setup.indexOf("reserveMfaAttempt(userId, 'manage')") < setup.indexOf('verifyTotp('))
  // AUTH-54: a success gives back one slot only; the day counter is never reset by it.
  const refund = state.slice(state.indexOf('async function refundMfaAttempt'), state.indexOf('/** True at most once a day'))
  assert.match(refund, /GREATEST\(0, "failCount" - 1\)/)
  assert.doesNotMatch(refund, /dayFailCount/)
  assert.match(state, /"lockNotifiedAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '24 hours'/)
  assert.match(state, /"wrongCodeNotifiedAt" < \(now\(\) AT TIME ZONE 'UTC'\) - interval '24 hours'/)
  // AUTH-53: a new sign-in never expires the owner's live challenge; expired rows still go.
  const create = state.slice(state.indexOf('export async function createMfaChallenge'), state.indexOf('export type MfaVerifyResult'))
  assert.match(create, /deleteMany\(\{ where: \{ userId, expiresAt: \{ lte: nowDate \} \} \}\)/)
  assert.doesNotMatch(create, /updateMany/)
  // AUTH-50: an already verified (unconsumed) challenge answers success again.
  assert.match(verify, /verifiedAt: \{ not: null \}, consumedAt: null[\s\S]*method: 'already_verified'/)
  // AUTH-48 / enrolment.
  assert.match(state, /process\.env\.MFA_TABLES_REQUIRED === '1'/)
  assert.match(state, /if \(!owner\?\.emailVerified\) return \{ error: 'email_unverified' \}/)

  // AUTH-52: password proof is limited (reserved first) with one generic message; setup prechecks first.
  const account = readFileSync('src/lib/mfa-account.ts', 'utf8')
  const prove = account.slice(account.indexOf('export async function proveAccountOwner'))
  assert.ok(prove.indexOf('recordFailure(passwordKey(userId)') < prove.indexOf('verifyPassword('))
  assert.match(prove, /releaseAttempt\(passwordKey\(userId\)\)/)
  assert.doesNotMatch(account, /Contraseña incorrecta/)
  assert.match(account, /PASSWORD_PROOF_LIMIT = 5/)
  const setupRoute = readFileSync('src/app/api/account/2fa/setup/route.ts', 'utf8')
  assert.ok(setupRoute.indexOf('mfaSetupPrecheck(') < setupRoute.indexOf('proveAccountOwner('))
  for (const f of ['setup', 'disable']) {
    assert.match(readFileSync(`src/app/api/account/2fa/${f}/route.ts`, 'utf8'), /proveAccountOwner\(request, auth\.userId, body\?\.password\)/, f)
  }
  for (const f of ['disable', 'recovery-codes']) {
    const src = readFileSync(`src/app/api/account/2fa/${f}/route.ts`, 'utf8')
    assert.ok(src.indexOf('reserveMfaIpSlot(') < src.indexOf('verifyCurrentFactor('), f)
  }
  assert.match(account, /FRESH_SIGN_IN_MS = 15 \* 60_000/)
  // AUTH-53: password reset lifts the code lock.
  assert.match(readFileSync('src/app/api/auth/reset-password/route.ts', 'utf8'), /clearMfaBudgets\(users\[0\]\.id\)/)
  // AUTH-54: first wrong code of the day emails the owner.
  const verifyRoute = readFileSync('src/app/api/auth/2fa/verify/route.ts', 'utf8')
  assert.ok(verifyRoute.indexOf('reserveMfaIpSlot(') < verifyRoute.indexOf('verifyMfaChallenge({'))
  assert.match(verifyRoute, /shouldNotifyWrongCode\(userId\)/)
  assert.doesNotMatch(verifyRoute, /mfaThrottled|recordMfaFailure/)
  // AUTH-50.
  const enable = readFileSync('src/app/api/account/2fa/enable/route.ts', 'utf8')
  assert.match(enable, /try \{\s*await revokeUserSessions\(auth\.userId\)\s*\} catch \{\s*sessionsEnded = false/)
  // AUTH-49 + invite page: pending session goes to the code page and comes back.
  const auth = readFileSync('src/lib/auth-options.ts', 'utf8')
  assert.match(auth, /if \(pending && !\(await mfaOnOrUnknown\(user\.id\)\)\)/)
  assert.match(auth, /decision === 'join_invite' && pending && !deferInviteFor2fa/)
  assert.match(auth, /\(next as \{ authAt\?: number \}\)\.authAt = Date\.now\(\)/)
  const invite = readFileSync('src/app/auth/accept-invite/page.tsx', 'utf8')
  assert.equal((invite.match(/window\.location\.assign\(mfaPageForInvite\(token\)\)/g) || []).length, 3)
  const mw = readFileSync('src/middleware.ts', 'utf8')
  assert.match(mw, /tokenError === 'mfa_unavailable'/)
  assert.match(mw, /!tenantId && \(pathname === '\/api\/account\/2fa' \|\| pathname\.startsWith\('\/api\/account\/2fa\/'\)\)/)
  // AUTH-51.
  assert.match(readFileSync('src/app/api/cron/workspace-retention/route.ts', 'utf8'), /purgeOldMfaChallenges\(\)/)
})

test('invite return path: only a real invite link is let through after the code', () => {
  const token = 'a'.repeat(64)
  assert.equal(safeMfaCallback(`/auth/accept-invite?token=${token}`), `/auth/accept-invite?token=${token}`)
  const page = mfaPageForInvite(token)
  assert.equal(page, `/auth/2fa?callbackUrl=${encodeURIComponent(`/auth/accept-invite?token=${token}`)}`)
  assert.equal(safeMfaCallback(new URL(page, 'https://x.test').searchParams.get('callbackUrl')), `/auth/accept-invite?token=${token}`)
  for (const bad of [
    '/auth/accept-invite?token=short',
    `/auth/accept-invite?token=${token}&next=//evil.test`,
    `/auth/accept-invite?token=${token}#x`,
    `/auth/accept-invite/../signin?token=${token}`,
    `//auth/accept-invite?token=${token}`,
  ]) {
    assert.equal(safeMfaCallback(bad), '/dashboard', bad)
  }
})
