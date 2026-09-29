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
  assert.match(users, /role === 'OWNER' && auth\.role !== 'OWNER'/)
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
