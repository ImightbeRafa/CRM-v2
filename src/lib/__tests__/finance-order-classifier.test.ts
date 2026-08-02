import assert from 'node:assert/strict';
import { classifyFinanceOrder } from '@/lib/finance-order-classifier';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

test('malformed customFields.source never throws; DeepSleep stays served as unassigned', () => {
  const weirdSource = { toString: 1 } as unknown;
  const result = classifyFinanceOrder({
    tenantSlug: 'deepsleep',
    product: '4 unidades disponibles',
    customFields: { source: weirdSource },
  });
  assert.equal(result.business, 'unassigned');
  assert.equal(result.needsManualAssignment, true);
});

test('malformed source on Bloom still serves business=bloom', () => {
  const weirdSource = { toString: 1 } as unknown;
  const result = classifyFinanceOrder({
    tenantSlug: 'bloom',
    product: 'Sleeping patches',
    customFields: { source: weirdSource },
  });
  assert.equal(result.business, 'bloom');
  assert.equal(result.needsManualAssignment, false);
});

test('uncategorized leftovers are unassigned rows, not dropped', () => {
  const result = classifyFinanceOrder({
    tenantSlug: 'deepsleep',
    seller: 'Compu Ma',
    product: '4 unidades disponibles',
  });
  assert.equal(result.business, 'unassigned');
  assert.equal(result.needsManualAssignment, true);
});

test('web source and product aliases still work', () => {
  assert.equal(
    classifyFinanceOrder({
      tenantSlug: 'deepsleep',
      customFields: { source: 'PatchHouse Website' },
    }).business,
    'patchhouse',
  );
  assert.equal(
    classifyFinanceOrder({
      tenantSlug: 'deepsleep',
      seller: 'WhatsDeepSleep',
      product: '2 bucales',
    }).business,
    'deepsleep',
  );
});

/** Mirrors manual-inbox hasMore decision in finance-orders.ts */
function manualScanHasMore(pageFull: boolean, index: number, batchLength: number, batchSize: number) {
  if (!pageFull) return false;
  const stoppedMidBatch = index < batchLength - 1;
  return stoppedMidBatch || batchLength === batchSize;
}

test('manual inbox pagination emits cursor when stopping mid short batch', () => {
  // Page filled at index 2 of a 5-row short batch — remaining unassigned must not be lost.
  assert.equal(manualScanHasMore(true, 2, 5, 50), true);
  // Page filled on last row of short batch — truly done.
  assert.equal(manualScanHasMore(true, 4, 5, 50), false);
  // Page filled on last row of full batch — more may exist in DB.
  assert.equal(manualScanHasMore(true, 49, 50, 50), true);
});

console.log('\nAll committed finance classifier tests passed.');
