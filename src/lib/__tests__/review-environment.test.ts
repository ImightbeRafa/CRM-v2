import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { arePreviewFeaturesUnlocked } from '../review-environment';

describe('preview feature unlock', () => {
  const originalVercel = process.env.VERCEL_ENV;

  function restore() {
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
  }

  it('unlocks Vercel preview', () => {
    process.env.VERCEL_ENV = 'preview';
    assert.equal(arePreviewFeaturesUnlocked(), true);
    restore();
  });

  it('stays locked on Vercel production', () => {
    process.env.VERCEL_ENV = 'production';
    assert.equal(arePreviewFeaturesUnlocked(), false);
    restore();
  });
});
