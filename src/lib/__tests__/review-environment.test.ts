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

  function restore() {
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
    if (originalNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNode;
  }

  function setEnv(overrides: {
    vercel?: string | undefined;
    node?: string | undefined;
  }) {
    if (overrides.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = overrides.vercel;
    if (overrides.node === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = overrides.node;
  }

  it('never unlocks on Vercel production', () => {
    setEnv({ vercel: 'production', node: 'production' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), false);
    restore();
  });

  it('unlocks v2 for every tenant on Vercel Preview, including real stores', () => {
    setEnv({ vercel: 'preview' });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(null), true);
    restore();
  });

  it('unlocks v2 for every tenant on local next dev', () => {
    setEnv({ vercel: undefined, node: 'development' });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), true);
    restore();
  });

  it('stays locked in tests without a review env', () => {
    setEnv({ vercel: undefined, node: 'test' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });
});
