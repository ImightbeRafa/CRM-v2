import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arePreviewFeaturesUnlockedForTenant,
  shouldShowPreviewDataWarning,
} from '../review-environment';

const ISOLATED = 'cmteijij70000jsoyedmtfnl1';
const OTHER = 'cm-other-store-tenant';

describe('preview feature unlock', () => {
  const originalVercel = process.env.VERCEL_ENV;
  const originalNode = process.env.NODE_ENV;
  const originalTenant = process.env.BETSY_V2_TEST_TENANT_ID;

  function restore() {
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
    if (originalNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNode;
    if (originalTenant === undefined) delete process.env.BETSY_V2_TEST_TENANT_ID;
    else process.env.BETSY_V2_TEST_TENANT_ID = originalTenant;
  }

  function setEnv(overrides: {
    vercel?: string | undefined;
    node?: string | undefined;
    tenant?: string | undefined;
  }) {
    if (overrides.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = overrides.vercel;
    if (overrides.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = overrides.node;
    if (overrides.tenant === undefined) delete process.env.BETSY_V2_TEST_TENANT_ID;
    else process.env.BETSY_V2_TEST_TENANT_ID = overrides.tenant;
  }

  it('never unlocks on Vercel production, even with a matching tenant id', () => {
    setEnv({ vercel: 'production', node: 'production', tenant: ISOLATED });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });

  it('shows the Preview warning on Vercel preview without unlocking every tenant', () => {
    setEnv({ vercel: 'preview', tenant: ISOLATED });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(''), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(null), false);
    restore();
  });

  it('unlocks v2 only for the exact isolated tenant on Preview', () => {
    setEnv({ vercel: 'preview', tenant: ISOLATED });
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), true);
    restore();
  });

  it('fails closed on Preview when BETSY_V2_TEST_TENANT_ID is unset', () => {
    setEnv({ vercel: 'preview', tenant: undefined });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });

  it('unlocks local next dev only when the isolated tenant is opted in', () => {
    setEnv({ vercel: undefined, node: 'development', tenant: ISOLATED });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), false);
    restore();
  });

  it('stays locked in tests without a review env or tenant opt-in', () => {
    setEnv({ vercel: undefined, node: 'test', tenant: undefined });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });
});
