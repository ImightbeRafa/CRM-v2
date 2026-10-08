import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  arePreviewFeaturesUnlockedForTenant,
  shouldShowPreviewDataWarning,
} from '../review-environment';

const ISOLATED = 'cmteijij70000jsoyedmtfnl1';
const OTHER = 'cm-other-store-tenant';

test('the Worker forwards APP_ENV and no BLOB_* key', () => {
  const worker = readFileSync('src/cf-container-worker.ts', 'utf8').replace(/\r\n/g, '\n');
  assert.match(worker, /"APP_ENV",/);
  assert.doesNotMatch(worker, /"BLOB_[A-Z_]+",/);
});

describe('preview feature unlock', () => {
  // Writable view: Next types NODE_ENV as read-only, but these tests must toggle it.
  const env = process.env as Record<string, string | undefined>;
  const originalAppEnv = process.env.APP_ENV;
  const originalNode = process.env.NODE_ENV;

  function restore() {
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    if (originalNode === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalNode;
  }

  function setEnv(overrides: {
    appEnv?: string | undefined;
    node?: string | undefined;
  }) {
    if (overrides.appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = overrides.appEnv;
    if (overrides.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = overrides.node;
  }

  it('never unlocks on APP_ENV=production', () => {
    setEnv({ appEnv: 'production', node: 'production' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), false);
    restore();
  });

  it('is case/whitespace insensitive: "PRODUCTION " stays production', () => {
    setEnv({ appEnv: 'PRODUCTION ' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });

  it('unlocks v2 for every tenant on APP_ENV=preview, including real stores', () => {
    setEnv({ appEnv: 'preview' });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(null), true);
    restore();
  });

  it('unlocks v2 for every tenant on APP_ENV=development', () => {
    setEnv({ appEnv: 'development' });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), true);
    restore();
  });

  it('fails closed on an unknown APP_ENV value', () => {
    setEnv({ appEnv: 'staging' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });

  it('unlocks v2 for every tenant on local next dev (APP_ENV unset)', () => {
    setEnv({ appEnv: undefined, node: 'development' });
    assert.equal(shouldShowPreviewDataWarning(), true);
    assert.equal(arePreviewFeaturesUnlockedForTenant(OTHER), true);
    restore();
  });

  it('stays locked in tests without a review env', () => {
    setEnv({ appEnv: undefined, node: 'test' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });

  it('unset APP_ENV + NODE_ENV=production (container default) stays production', () => {
    setEnv({ appEnv: undefined, node: 'production' });
    assert.equal(shouldShowPreviewDataWarning(), false);
    assert.equal(arePreviewFeaturesUnlockedForTenant(ISOLATED), false);
    restore();
  });
});
