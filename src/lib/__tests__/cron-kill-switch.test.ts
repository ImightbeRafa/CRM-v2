import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronsDisabled } from '../cron-kill-switch';
import { shouldUseSparticuzChromium } from '../use-sparticuz-chromium';

/** Partial env for pure helpers (Next types make NODE_ENV required on ProcessEnv). */
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('cronsDisabled', () => {
  it('is on only for 1 or true', () => {
    assert.equal(cronsDisabled({} as NodeJS.ProcessEnv), false);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: '' })), false);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: '0' })), false);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: 'false' })), false);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: 'yes' })), false);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: '1' })), true);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: 'true' })), true);
    assert.equal(cronsDisabled(env({ DISABLE_CRONS: ' TRUE ' })), true);
  });
});

describe('shouldUseSparticuzChromium', () => {
  it('stays on for Vercel and Lambda, and for an explicit container flag', () => {
    assert.equal(shouldUseSparticuzChromium({} as NodeJS.ProcessEnv), false);
    assert.equal(shouldUseSparticuzChromium(env({ VERCEL: '1' })), true);
    assert.equal(shouldUseSparticuzChromium(env({ AWS_LAMBDA_FUNCTION_NAME: 'fn' })), true);
    assert.equal(shouldUseSparticuzChromium(env({ USE_SPARTICUZ_CHROMIUM: '1' })), true);
    assert.equal(shouldUseSparticuzChromium(env({ USE_SPARTICUZ_CHROMIUM: 'true' })), true);
    assert.equal(shouldUseSparticuzChromium(env({ USE_SPARTICUZ_CHROMIUM: '0' })), false);
  });
});
