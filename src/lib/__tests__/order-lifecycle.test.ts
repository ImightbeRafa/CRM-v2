import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { chooseClientIdentityMatch, extractInventoryRequests, normalizeClientEmail, normalizeClientPhone } from '../order-lifecycle';
import { calculateIncludedIva, invoiceGrossFromItems } from '../invoice-calculation';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

test('client identity normalizes Costa Rica phone and email deterministically', () => {
  assert.equal(normalizeClientPhone('+506 8888-7777'), '88887777');
  assert.equal(normalizeClientPhone('8888 7777'), '88887777');
  assert.equal(normalizeClientPhone(''), null);
  assert.equal(normalizeClientEmail(' Owner@Example.COM '), 'owner@example.com');
});

test('inventory parsing prefers detailed quantities and never fuzzy-matches here', () => {
  assert.deepEqual(extractInventoryRequests({
    product: 'ignored legacy value',
    productDetails: JSON.stringify([{ sku: 'SKU-1', cantidad: 2 }, { type: 'Exact Name', quantity: 3 }]),
  }), [
    { key: 'SKU-1', quantity: 2 },
    { key: 'Exact Name', quantity: 3 },
  ]);
  assert.deepEqual(extractInventoryRequests({ product: 'Only Product', quantity: 4 }), [{ key: 'Only Product', quantity: 4 }]);
});

test('phone wins, disagreement queues conflict, and email never overrides a different phone', () => {
  assert.deepEqual(
    chooseClientIdentityMatch('88887777', [{ id: 'phone-client', normalizedPhone: '88887777' }], [{ id: 'other-email' }]),
    { matchId: null, conflict: { reason: 'phone_email_disagree', candidateIds: ['phone-client', 'other-email'] } },
  );
  assert.deepEqual(
    chooseClientIdentityMatch('88887777', [], [{ id: 'email-client', normalizedPhone: '11112222' }]),
    { matchId: null, conflict: { reason: 'email_phone_disagree', candidateIds: ['email-client'] } },
  );
  assert.deepEqual(
    chooseClientIdentityMatch(null, [], [{ id: 'email-client', normalizedPhone: '11112222' }]),
    { matchId: 'email-client', conflict: null },
  );
});

test('IVA is extracted from gross and never added to Order.total', () => {
  const result = calculateIncludedIva(113_000);
  assert.deepEqual(result, { subtotal: 100_000, tax: 13_000, discount: 0, total: 113_000, calculationVersion: 2 });
  assert.equal(invoiceGrossFromItems([{ quantity: 2, unitPrice: 10_000 }]), 20_000);
});

test('all non-bot adapters use the one tenant lifecycle flag', () => {
  const files = [
    'src/app/api/orders/route.ts',
    'src/app/api/orders/update/route.ts',
    'src/app/api/orders/status/route.ts',
    'src/app/api/orders/confirm-payment/route.ts',
    'src/app/api/import/excel/route.ts',
    'src/lib/integration-orders.ts',
    'src/lib/bot/guia-service.ts',
  ];
  for (const file of files) {
    assert.match(source(file), /shouldUseOrderLifecycleV2|createLifecycleOrder|updateLifecycleOrder|setLifecycleOrderStatus/);
  }
  assert.match(source('src/lib/feature-flags.ts'), /ORDER_LIFECYCLE_V2_FLAG = 'order_lifecycle_v2'/);
  assert.match(source('src/lib/feature-flags.ts'), /clientBackfillCompletedAt/);
  assert.doesNotMatch(source('src/lib/feature-flags.ts'), /ORDER_LIFECYCLE_V2_CHANNELS/);
});

test('bot order creation remains on the legacy lifecycle until inbox migration', () => {
  const tools = source('src/lib/bot/ai-tools.ts');
  assert.doesNotMatch(tools, /createLifecycleOrder|updateLifecycleOrder/);
});

test('schema additions remain additive and historical invoices stay version 1', () => {
  const schema = source('prisma/schema.prisma');
  assert.match(schema, /clientId\s+String\?/);
  assert.match(schema, /lifecycleVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /calculationVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /model ClientIdentityConflict/);
  assert.match(schema, /model OrderInventoryAllocation/);
});

test('backfill package is tenant-scoped and dry-run by default', () => {
  const script = source('scripts/betsy-v2-client-backfill.ts');
  assert.match(script, /Exact --tenant=<id> is required/);
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /BETSY_V2_BACKFILL_APPROVED_TENANT/);
  assert.doesNotMatch(script, /updateMany\(\{\s*data:/);
});
