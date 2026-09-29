/**
 * Invite pre-hijack + self-reactivation (security, 2026-09-28). Knowing an invited address must
 * never be enough to join that business, and verifying an email must never re-enable an account.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { canAutoAcceptInvite, inviteTokenMatches } from '../team-invite'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('an invite is auto-accepted only with proof of the mailbox', () => {
  assert.equal(canAutoAcceptInvite({ viaToken: false, emailVerified: false }), false)
  assert.equal(canAutoAcceptInvite({ viaToken: true, emailVerified: false }), true)
  assert.equal(canAutoAcceptInvite({ viaToken: false, emailVerified: true }), true)
})

test('invite token comparison', () => {
  const t = 'a'.repeat(64)
  assert.equal(inviteTokenMatches(t, t), true)
  assert.equal(inviteTokenMatches('b'.repeat(64), t), false)
  assert.equal(inviteTokenMatches('a', t), false)
  for (const bad of [undefined, null, '', 42, {}]) assert.equal(inviteTokenMatches(bad, t), false)
  assert.equal(inviteTokenMatches(t, null), false)
  assert.equal(inviteTokenMatches(t, ''), false)
})

test('register: without the invite token the user gets no business and the invite stays pending', () => {
  const src = read('src/app/api/auth/register/route.ts')
  // The invite named by the presented token, not the newest one for the address (AUTH-09).
  assert.match(src, /const held = await findInviteForPresentedToken\(presentedToken, normalizedEmail\)/)
  assert.match(src, /const viaToken = !!held && inviteTokenMatches\(presentedToken, held\.token\)/)
  assert.match(src, /defaultTenantId: viaToken \? invite\.tenantId : null/)
  assert.match(src, /if \(!canAutoAcceptInvite\(\{ viaToken, emailVerified: false \}\)\)/)
  // The tenant name is not revealed to someone who only knows the address.
  assert.doesNotMatch(src.split('canAutoAcceptInvite({ viaToken')[1].split('acceptTeamInviteForUser')[0], /tenantName/)
})

test('login and Google join an invite only with its emailed token (AUTH-08/09)', () => {
  const src = read('src/lib/auth-options.ts')
  assert.doesNotMatch(src, /findPendingInviteForEmail/, 'no "newest invite for this email" auto-join')
  assert.match(src, /findInviteForPresentedToken\(\s*inviteTokenFromCookieHeader\(/)
  assert.equal((src.match(/findInviteForPresentedToken\(await readInviteTokenCookie\(\)/g) || []).length, 2)
  // First Google proof of an unverified account drops a possibly squatted password + sessions.
  assert.match(src, /\.\.\.\(!dbUser\.emailVerified \? \{ password: null \} : \{\}\)/)
  assert.match(src, /if \(!dbUser\.emailVerified\) \{[\s\S]{0,160}revokeUserSessions\(dbUser\.id\)/)
})

test('verify-email and admin-created accounts never join or pre-verify', () => {
  assert.doesNotMatch(read('src/app/api/auth/verify-email/route.ts'), /acceptTeamInviteForUser|findPendingInviteForEmail/)
  assert.match(read('src/app/api/users/route.ts'), /^\s*emailVerified: null,/m)
})

test('OAuth rejects a provider-unverified email', () => {
  const src = read('src/lib/auth-options.ts')
  assert.match(src, /email_verified === false\) \{\s*console\.error\('\[OAuth\] Rejected sign-in/)
})

test('accepting an invite never flips active; emailVerified only with proof', () => {
  const src = read('src/lib/team-invite-service.ts')
  const update = src.split('await tx.user.update({')[1].split('return {')[0]
  assert.doesNotMatch(update, /active:\s*true/)
  assert.match(update, /input\.emailProven \? \{ emailVerified: new Date\(\) \} : \{\}/)
  // Every caller states whether the mailbox is proven (required field).
  for (const f of ['src/app/api/auth/register/route.ts', 'src/lib/auth-options.ts', 'src/app/api/invites/accept/route.ts', 'src/app/api/auth/verify-email/route.ts']) {
    const s = read(f)
    const calls = s.split('acceptTeamInviteForUser({').length - 1
    const proven = (s.match(/acceptTeamInviteForUser\(\{\s*emailProven: (true|false)/g) || []).length
    assert.equal(proven, calls, f)
  }
})

test('verify-email refuses deactivated users and never sets active', () => {
  const src = read('src/app/api/auth/verify-email/route.ts')
  assert.match(src, /if \(userData\.active === false\)/)
  assert.doesNotMatch(src, /"active" = true,/)
  assert.match(src, /WHERE id = \$\{userData\.id\} AND "active" = true/)
})

test('resend-verification: one generic answer, case-insensitive, skips inactive', () => {
  const src = read('src/app/api/auth/resend-verification/route.ts')
  assert.match(src, /mode: 'insensitive'/)
  assert.match(src, /user\.active === false/)
  assert.doesNotMatch(src, /status: 500 \}\s*\);\s*\}\s*return NextResponse\.json\(\{\s*success: true,\s*message: 'Verification email sent/)
  assert.equal((src.match(/NextResponse\.json\(GENERIC/g) || []).length, 2)
})
