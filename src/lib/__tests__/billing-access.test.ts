import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeTenantAccess, type TenantBillingSnapshot } from '../billing-access';

const NOW = new Date('2026-08-26T12:00:00.000Z');

function tenant(overrides: Partial<TenantBillingSnapshot> = {}): TenantBillingSnapshot {
  return {
    id: 'tenant-test',
    plan: 'FREE',
    isActive: true,
    subscriptionStatus: 'active',
    trialEndsAt: null,
    currentPeriodEnd: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    settings: {},
    ...overrides,
  };
}

const enforceTenantFlag = {
  scope: 'tenant-test',
  key: 'billing_access',
  enabled: true,
  config: {
    rolloutMode: 'ENFORCE',
    observeStartedAt: '2026-08-01T00:00:00.000Z',
    warnStartedAt: '2026-08-08T00:00:00.000Z',
    enforcementApprovedAt: '2026-08-15T00:00:00.000Z',
  },
};

describe('billing access state', () => {
  it('keeps legacy explicit FREE tenants without a trial date active', () => {
    const result = computeTenantAccess(tenant(), [], NOW);
    assert.equal(result.state, 'ACTIVE');
    assert.equal(result.writeAllowed, true);
  });

  it('uses exact FREE trial and grace boundaries', () => {
    const trialEndsAt = new Date('2026-08-20T12:00:00.000Z');
    const snapshot = tenant({ trialEndsAt });

    assert.equal(computeTenantAccess(snapshot, [], new Date(trialEndsAt.getTime() - 1)).state, 'ACTIVE');
    assert.equal(computeTenantAccess(snapshot, [], trialEndsAt).state, 'GRACE');
    assert.equal(
      computeTenantAccess(snapshot, [], new Date(trialEndsAt.getTime() + 7 * 86_400_000 - 1)).state,
      'GRACE',
    );
    assert.equal(
      computeTenantAccess(snapshot, [], new Date(trialEndsAt.getTime() + 7 * 86_400_000)).state,
      'RESTRICTED',
    );
  });

  it('starts paid grace at the contract period end', () => {
    const periodEnd = new Date('2026-08-25T12:00:00.000Z');
    const snapshot = tenant({ plan: 'BASIC', currentPeriodEnd: periodEnd });
    assert.equal(computeTenantAccess(snapshot, [], NOW).state, 'GRACE');
    assert.equal(
      computeTenantAccess(snapshot, [], new Date(periodEnd.getTime() + 7 * 86_400_000)).state,
      'RESTRICTED',
    );
  });

  it('uses stored payment-failure grace without extending it per request', () => {
    const snapshot = tenant({
      plan: 'PRO',
      subscriptionStatus: 'payment_failed',
      settings: {
        billingAccess: {
          graceStartedAt: '2026-08-18T12:00:00.000Z',
          graceEndsAt: '2026-08-25T12:00:00.000Z',
        },
      },
    });
    assert.equal(computeTenantAccess(snapshot, [], NOW).state, 'RESTRICTED');
  });

  it('enforces only after the staged timeline, approval, and global switch', () => {
    const restricted = tenant({ isActive: false });
    const globalOn = {
      scope: 'global',
      key: 'billing_write_enforcement',
      enabled: true,
      config: null,
    };

    const enforced = computeTenantAccess(restricted, [enforceTenantFlag, globalOn] as any, NOW);
    assert.equal(enforced.effectiveRolloutMode, 'ENFORCE');
    assert.equal(enforced.writeAllowed, false);

    const killed = computeTenantAccess(
      restricted,
      [enforceTenantFlag, { ...globalOn, enabled: false }] as any,
      NOW,
    );
    assert.equal(killed.effectiveRolloutMode, 'OBSERVE');
    assert.equal(killed.enforcementKilled, true);
    assert.equal(killed.wouldRestrict, true);
    assert.equal(killed.writeAllowed, true);
  });

  it('cannot skip the seven-day observe and warn windows', () => {
    const restricted = tenant({ isActive: false });
    const tooEarly = {
      ...enforceTenantFlag,
      config: {
        rolloutMode: 'ENFORCE',
        observeStartedAt: '2026-08-19T12:00:00.001Z',
        warnStartedAt: '2026-08-25T12:00:00.000Z',
        enforcementApprovedAt: '2026-08-26T11:00:00.000Z',
      },
    };
    const result = computeTenantAccess(restricted, [
      tooEarly,
      { scope: 'global', key: 'billing_write_enforcement', enabled: true, config: null },
    ] as any, NOW);
    assert.equal(result.writeAllowed, true);
    assert.notEqual(result.effectiveRolloutMode, 'ENFORCE');
  });

  it('does not enter warning mode before the configured warning start', () => {
    const result = computeTenantAccess(tenant({ isActive: false }), [
      {
        ...enforceTenantFlag,
        config: {
          rolloutMode: 'WARN',
          observeStartedAt: '2026-08-01T00:00:00.000Z',
          warnStartedAt: '2026-08-27T12:00:00.001Z',
        },
      },
      { scope: 'global', key: 'billing_write_enforcement', enabled: true, config: null },
    ] as any, NOW);

    assert.equal(result.effectiveRolloutMode, 'OBSERVE');
    assert.equal(result.writeAllowed, true);
  });
});
