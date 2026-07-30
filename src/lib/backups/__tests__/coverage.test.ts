import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REQUIRED_LM_TABLES } from '../config';
import { compareCoverage, scanLmTableReferences } from '../coverage';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..', '..');

describe('lm_* coverage allowlist', () => {
  it('includes every lm_* table referenced in src/ and supabase/', async () => {
    const referenced = await scanLmTableReferences(root);
    const report = compareCoverage(referenced);
    assert.deepEqual(
      report.referencedButUnlisted,
      [],
      `Referenced lm_* missing from allowlist: ${report.referencedButUnlisted.join(', ')}`,
    );
    assert.ok(report.requiredAllowlist.length === REQUIRED_LM_TABLES.length);
  });

  it('fails when a live required table is missing', () => {
    const referenced = [...REQUIRED_LM_TABLES];
    const live = REQUIRED_LM_TABLES.filter((t) => t !== 'lm_orders');
    const report = compareCoverage(referenced, live);
    assert.equal(report.ok, false);
    assert.ok(report.liveMissingRequired?.includes('lm_orders'));
  });
});
