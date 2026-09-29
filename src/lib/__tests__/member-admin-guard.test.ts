/** AUTH-23 role hierarchy + M2 membership-aware sessions (security, 2026-09-29). No DB. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { checkMemberChange } from '../member-admin-guard'
import { membershipAllows, roleCovers } from '../session-revocation'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')
const base = { actorUserId: 'admin1', actorRole: 'ADMIN', targetUserId: 'u2', targetRole: 'SALES', targetActive: true, activeOwnerCount: 1 }

test('an ADMIN cannot grant OWNER, nor touch an OWNER', () => {
  assert.equal(checkMemberChange({ ...base, newRole: 'OWNER' }).ok, false)
  assert.equal(checkMemberChange({ ...base, targetRole: 'OWNER', targetUserId: 'owner1', newRole: 'VIEWER' }).ok, false)
  assert.equal(checkMemberChange({ ...base, targetRole: 'OWNER', targetUserId: 'owner1', remove: true }).ok, false)
})

test('nobody changes their own role or removes themselves (no self-promotion)', () => {
  assert.equal(checkMemberChange({ ...base, targetUserId: 'admin1', targetRole: 'ADMIN', newRole: 'OWNER' }).ok, false)
  assert.equal(checkMemberChange({ ...base, actorRole: 'OWNER', actorUserId: 'o', targetUserId: 'o', targetRole: 'OWNER', remove: true }).ok, false)
})

test('the last active OWNER cannot be demoted or removed; a second one can', () => {
  const owner = { ...base, actorUserId: 'o1', actorRole: 'OWNER', targetUserId: 'o2', targetRole: 'OWNER' }
  assert.equal(checkMemberChange({ ...owner, activeOwnerCount: 1, newRole: 'ADMIN' }).ok, false)
  assert.equal(checkMemberChange({ ...owner, activeOwnerCount: 2, newRole: 'ADMIN' }).ok, true)
  assert.equal(checkMemberChange({ ...owner, activeOwnerCount: 2, remove: true }).ok, true)
})

test('normal admin work still passes; bogus roles are refused', () => {
  assert.equal(checkMemberChange({ ...base, newRole: 'MANAGER' }).ok, true)
  assert.equal(checkMemberChange({ ...base, remove: true }).ok, true)
  assert.equal(checkMemberChange({ ...base, newRole: 'MASTER' }).ok, false)
  assert.equal(checkMemberChange({ ...base, actorRole: 'OWNER', newRole: 'OWNER' }).ok, true)
})

test('all member endpoints run the guard', () => {
  const users = read('src/app/api/users/route.ts')
  assert.equal((users.match(/await guardMemberChange\(auth, membership/g) || []).length, 2)
  assert.match(users, /actor\?\.role !== 'OWNER'/, 'POST checks the actor role from the DB')
  assert.equal((read('src/app/api/users/[id]/route.ts').match(/await guardMemberChange\(auth, membership/g) || []).length, 2)
})

test('sessions follow the membership: removal and downgrade end them, promotion does not', () => {
  assert.equal(membershipAllows(null, 'SALES'), false, 'removed from the business')
  assert.equal(membershipAllows({ active: false, role: 'SALES' }, 'SALES'), false)
  assert.equal(membershipAllows({ active: true, role: 'SALES' }, 'ADMIN'), false, 'downgraded')
  assert.equal(membershipAllows({ active: true, role: 'ADMIN' }, 'SALES'), true, 'promoted: fine until refresh')
  assert.equal(roleCovers('SALES', 'PRODUCTION'), false)
  assert.equal(roleCovers('SALES', 'VIEWER'), true, 'VIEWER is the middleware fallback')
  assert.equal(roleCovers('ADMIN', 'OWNER'), false, 'the MASTER→OWNER fallback cannot escalate')
})

test('reactivating a removed OWNER is Owner-only (AUTH-25); actor role comes from the DB (AUTH-28)', () => {
  const removedOwner = { ...base, targetUserId: 'o2', targetRole: 'OWNER', targetActive: false, reactivate: true }
  assert.equal(checkMemberChange(removedOwner).ok, false, 'an ADMIN cannot bring an Owner back')
  assert.equal(checkMemberChange({ ...removedOwner, actorRole: 'OWNER', actorUserId: 'o1' }).ok, true)
  assert.equal(checkMemberChange({ ...base, targetActive: false, reactivate: true }).ok, true, 'normal members can be reactivated')
  for (const f of ['src/app/api/users/route.ts', 'src/app/api/users/[id]/route.ts']) {
    const src = read(f)
    assert.match(src, /actorRole: actor\?\.role \?\? 'NONE'/, f)
    assert.match(src, /reactivate: active === true/, f)
  }
})

test('logistics API re-reads the grant and honours revocation (AUTH-26)', () => {
  const src = read('src/lib/logistics-auth.ts')
  assert.match(src, /await getLiveToken\(\{ req, secret: secret \|\| '' \}\)/)
  assert.match(src, /isLogisticsAdmin: current\.isLogisticsAdmin === true/)
  assert.doesNotMatch(src, /from 'next-auth\/jwt'/)
})

test('regressions guarded: inactive businesses not blocked here, Google-linked accounts can reset, invite accept idempotent', () => {
  assert.doesNotMatch(read('src/lib/session-revocation.ts'), /"Tenant"/, 'billing decides about inactive businesses')
  assert.doesNotMatch(read('src/app/api/auth/forgot-password/route.ts'), /provider !== 'credentials'/)
  const accept = read('src/app/api/invites/accept/route.ts')
  assert.equal((accept.match(/findInviteAcceptedBy\(token, session/g) || []).length, 2)
})

test('member routes accept only a real boolean `active` (guard and write see the same value)', () => {
  const byId = read('src/app/api/users/[id]/route.ts')
  assert.match(byId, /if \(active !== undefined && typeof active !== 'boolean'\)/)
  assert.doesNotMatch(byId, /Boolean\(active\)/)
  assert.match(read('src/app/api/users/route.ts'), /if \(active !== undefined && typeof active !== 'boolean'\)/)
  // POST: granting OWNER checks the actor's role in the DB (AUTH-28).
  assert.match(read('src/app/api/users/route.ts'), /if \(role === 'OWNER'\) \{[\s\S]{0,300}actor\?\.role !== 'OWNER'/)
})
