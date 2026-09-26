import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateInviteToken,
  inviteEmailsMatch,
  inviteExpiresAt,
  isAllowedInviteRole,
  isInviteAcceptable,
  normalizeInviteEmail,
  shouldJoinInviteInsteadOfProvisioning,
} from '../team-invite'

describe('team-invite', () => {
  it('normalizes emails and validates roles', () => {
    assert.equal(normalizeInviteEmail('  Rafa@Gmail.com '), 'rafa@gmail.com')
    assert.equal(isAllowedInviteRole('SALES'), true)
    assert.equal(isAllowedInviteRole('OWNER'), false)
    assert.equal(inviteEmailsMatch('A@x.com', 'a@x.com'), true)
  })

  it('generates opaque tokens and future expiry', () => {
    const a = generateInviteToken()
    const b = generateInviteToken()
    assert.equal(a.length, 64)
    assert.notEqual(a, b)
    assert.ok(inviteExpiresAt(1_000).getTime() > 1_000)
  })

  it('rejects accepted/revoked/expired invites', () => {
    const future = new Date(Date.now() + 60_000)
    const past = new Date(Date.now() - 60_000)
    assert.equal(isInviteAcceptable({ email: 'a@x.com', expiresAt: future }).ok, true)
    const accepted = isInviteAcceptable({ email: 'a@x.com', expiresAt: future, acceptedAt: new Date() })
    assert.equal(accepted.ok, false)
    if (!accepted.ok) assert.equal(accepted.reason, 'accepted')
    const revoked = isInviteAcceptable({ email: 'a@x.com', expiresAt: future, revokedAt: new Date() })
    assert.equal(revoked.ok, false)
    if (!revoked.ok) assert.equal(revoked.reason, 'revoked')
    const expired = isInviteAcceptable({ email: 'a@x.com', expiresAt: past })
    assert.equal(expired.ok, false)
    if (!expired.ok) assert.equal(expired.reason, 'expired')
  })

  it('joins invite instead of provisioning when membership-less with pending invite', () => {
    assert.equal(
      shouldJoinInviteInsteadOfProvisioning({
        activeMembershipCount: 0,
        pendingInvite: { tenantId: 't1', role: 'SALES' },
      }),
      'join_invite',
    )
    assert.equal(
      shouldJoinInviteInsteadOfProvisioning({
        activeMembershipCount: 2,
        pendingInvite: { tenantId: 't1', role: 'SALES' },
      }),
      'use_existing',
    )
    assert.equal(
      shouldJoinInviteInsteadOfProvisioning({
        activeMembershipCount: 0,
        pendingInvite: null,
      }),
      'provision_owned',
    )
  })
})
