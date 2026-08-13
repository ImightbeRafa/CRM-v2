import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnedTenantSlug,
  inviteMembershipAction,
  resolveDefaultTenantAfterRemoval,
  selectActiveTenantId,
} from '../membership-lifecycle';

describe('selectActiveTenantId', () => {
  it('prefers default when it is still an active membership', () => {
    assert.equal(
      selectActiveTenantId('tenant-b', ['tenant-a', 'tenant-b']),
      'tenant-b',
    );
  });

  it('ignores a default that is no longer active', () => {
    assert.equal(selectActiveTenantId('stale', ['tenant-a']), 'tenant-a');
  });

  it('returns null when there are no active memberships', () => {
    assert.equal(selectActiveTenantId('stale', []), null);
    assert.equal(selectActiveTenantId(null, []), null);
  });
});

describe('resolveDefaultTenantAfterRemoval', () => {
  it('clears default when the removed tenant was the only membership', () => {
    assert.equal(
      resolveDefaultTenantAfterRemoval('bloom', 'bloom', []),
      null,
    );
  });

  it('repoints default to a remaining active tenant', () => {
    assert.equal(
      resolveDefaultTenantAfterRemoval('bloom', 'bloom', ['other']),
      'other',
    );
  });

  it('keeps a default that still has an active membership', () => {
    assert.equal(
      resolveDefaultTenantAfterRemoval('keep', 'removed', ['keep', 'other']),
      'keep',
    );
  });
});

describe('inviteMembershipAction', () => {
  it('creates when no membership exists', () => {
    assert.equal(inviteMembershipAction(null), 'create');
  });

  it('conflicts when the membership is already active', () => {
    assert.equal(inviteMembershipAction({ isActive: true }), 'conflict');
  });

  it('reactivates an inactive membership instead of duplicating', () => {
    assert.equal(inviteMembershipAction({ isActive: false }), 'reactivate');
  });
});

describe('buildOwnedTenantSlug', () => {
  it('sanitizes the email prefix and appends a timestamp', () => {
    assert.equal(
      buildOwnedTenantSlug('Forge.CostaRica04@gmail.com', 123),
      'forge-costarica04-123',
    );
  });
});
