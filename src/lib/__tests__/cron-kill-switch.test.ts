import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cronsDisabled } from '../cron-kill-switch';
import { shouldUseSparticuzChromium } from '../use-sparticuz-chromium';

describe('cronsDisabled', () => {
  it('is on only for 1 or true', () => {
    assert.equal(cronsDisabled({} as NodeJS.ProcessEnv), false);
    assert.equal(cronsDisabled({ DISABLE_CRONS: '' }), false);
    assert.equal(cronsDisabled({ DISABLE_CRONS: '0' }), false);
    assert.equal(cronsDisabled({ DISABLE_CRONS: 'false' }), false);
    assert.equal(cronsDisabled({ DISABLE_CRONS: 'yes' }), false);
    assert.equal(cronsDisabled({ DISABLE_CRONS: '1' }), true);
    assert.equal(cronsDisabled({ DISABLE_CRONS: 'true' }), true);
    assert.equal(cronsDisabled({ DISABLE_CRONS: ' TRUE ' }), true);
  });
});

describe('shouldUseSparticuzChromium', () => {
  it('stays on for Vercel and Lambda, and for an explicit container flag', () => {
    assert.equal(shouldUseSparticuzChromium({} as NodeJS.ProcessEnv), false);
    assert.equal(shouldUseSparticuzChromium({ VERCEL: '1' }), true);
    assert.equal(shouldUseSparticuzChromium({ AWS_LAMBDA_FUNCTION_NAME: 'fn' }), true);
    assert.equal(shouldUseSparticuzChromium({ USE_SPARTICUZ_CHROMIUM: '1' }), true);
    assert.equal(shouldUseSparticuzChromium({ USE_SPARTICUZ_CHROMIUM: 'true' }), true);
    assert.equal(shouldUseSparticuzChromium({ USE_SPARTICUZ_CHROMIUM: '0' }), false);
  });
});
