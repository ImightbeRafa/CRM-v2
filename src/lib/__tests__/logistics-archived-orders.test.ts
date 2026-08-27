import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANAGED_TENANT_IDS } from '../logistics-managed-tenants';
import {
  fetchArchivedLogisticsOrders,
  sanitizeArchivedSearch,
} from '../logistics-archived-orders';

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS  ${name}`))
    .catch((err) => {
      console.error(`FAIL  ${name}`);
      throw err;
    });
}

await test('sanitizeArchivedSearch strips ILIKE wildcards and trims', () => {
  assert.equal(sanitizeArchivedSearch('  %Sandra_Isabel%  '), 'SandraIsabel');
  assert.equal(sanitizeArchivedSearch('a'.repeat(100)).length, 80);
});

await test('archive helper source does not apply the live-board cutoff', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/logistics-archived-orders.ts'), 'utf8');
  assert.equal(source.includes('2026-02-22'), false);
  assert.match(source, /ORDER BY lm\.archived_at DESC/);
  assert.match(source, /INNER JOIN "Order" o ON o\.id = lm\.crm_order_id/);
});

await test('archived GET route uses the dedicated helper and does not IN-list every archived id', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/logistics/orders/route.ts'), 'utf8');
  assert.match(source, /fetchArchivedLogisticsOrders/);
  assert.equal(source.includes("SELECT crm_order_id FROM lm_orders\n                    WHERE archived_at IS NOT NULL"), false);
});

const page = await fetchArchivedLogisticsOrders({
  tenantIds: MANAGED_TENANT_IDS,
  page: 1,
  limit: 20,
});

await test('archive page returns finished orders newest-archived first', () => {
  assert.ok(page.total > 20, `expected archived total > 20, got ${page.total}`);
  assert.equal(page.orders.length, 20);
  for (const order of page.orders) {
    assert.ok(order.archivedAt, `${order.orderId} missing archivedAt`);
    assert.ok(order.customerName, `${order.orderId} missing customerName`);
    assert.ok(MANAGED_TENANT_IDS.includes(order.tenantId), `unmanaged tenant ${order.tenantId}`);
  }
  const times = page.orders.map((o) => new Date(o.archivedAt).getTime());
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepEqual(times, sorted);
});

const sandra = await fetchArchivedLogisticsOrders({
  tenantIds: MANAGED_TENANT_IDS,
  search: 'Sandra Isabel García',
  page: 1,
  limit: 20,
});

await test('archive search finds terminated Sandra Isabel García orders', () => {
  assert.ok(sandra.total >= 1, 'expected at least one Sandra archived order');
  assert.ok(
    sandra.orders.some((o) => /sandra isabel garc[ií]a/i.test(o.customerName)),
    `Sandra not in results: ${sandra.orders.map((o) => o.customerName).join(', ')}`,
  );
});

const unmanaged = await fetchArchivedLogisticsOrders({
  tenantIds: ['not-a-managed-tenant'],
  page: 1,
  limit: 10,
});

await test('archive query stays inside the managed tenant allowlist', () => {
  assert.equal(unmanaged.total, 0);
  assert.equal(unmanaged.orders.length, 0);
});

console.log(`archived total=${page.total} first=${page.orders[0]?.customerName}`);
