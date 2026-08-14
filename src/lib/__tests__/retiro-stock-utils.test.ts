import assert from 'node:assert/strict';
import {
  buildAliasMapFromRows,
  extractOrderLines,
  mapOrderLinesLocal,
  normalizeProductName,
  orderContainsProductLabel,
  resolveSkuFromMap,
} from '../retiro-stock-utils';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

test('normalizeProductName strips accents, punctuation, and case', () => {
  assert.equal(normalizeProductName('  Pura S. Sandía  '), 'pura s sandia');
  assert.equal(normalizeProductName('Parche'), 'parche');
  assert.equal(normalizeProductName(''), '');
});

test('extractOrderLines prefers productDetails and keeps quantities', () => {
  const lines = extractOrderLines({
    product: 'Combo',
    quantity: 1,
    productDetails: JSON.stringify([
      { type: 'Parche', cantidad: 2 },
      { name: 'Focus', quantity: 1 },
    ]),
  });
  assert.deepEqual(lines, [
    { rawName: 'Parche', qty: 2 },
    { rawName: 'Focus', qty: 1 },
  ]);
});

test('extractOrderLines falls back to product + order quantity', () => {
  const lines = extractOrderLines({ product: 'Parche', quantity: 2 });
  assert.deepEqual(lines, [{ rawName: 'Parche', qty: 2 }]);
});

test('orderContainsProductLabel matches normalized labels only', () => {
  const order = { product: 'Parche', quantity: 2, productDetails: null };
  assert.equal(orderContainsProductLabel(order, 'parche'), true);
  assert.equal(orderContainsProductLabel(order, '  PARCHE  '), true);
  assert.equal(orderContainsProductLabel(order, 'Focus'), false);
  assert.equal(orderContainsProductLabel(order, ''), false);
});

test('resolveSkuFromMap prefers exact alias over substring matches', () => {
  const aliasMap = new Map<string, { sku: string; displayName: string }>([
    ['pura s', { sku: 'pura_s_menta', displayName: 'Pura S Menta' }],
    ['pura s sandia', { sku: 'pura_s_sandia', displayName: 'Pura S Sandia' }],
  ]);
  const exact = resolveSkuFromMap('Pura S Sandia', aliasMap);
  assert.equal(exact?.sku, 'pura_s_sandia');

  const unknown = resolveSkuFromMap('Parche', aliasMap);
  assert.equal(unknown, null);
});

test('mapOrderLinesLocal applies persisted aliases and leaves unknown products unmapped', () => {
  const aliasMap = buildAliasMapFromRows(
    [{ sku: 'focus', aliasNormalized: 'parche', displayName: 'Focus' }],
    [{ sku: 'focus', displayName: 'Focus' }],
  );
  const mapped = mapOrderLinesLocal({ product: 'Parche', quantity: 2 }, aliasMap);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].rawName, 'Parche');
  assert.equal(mapped[0].qty, 2);
  assert.equal(mapped[0].sku, 'focus');
  assert.equal(mapped[0].displayName, 'Focus');

  const emptyMap = buildAliasMapFromRows([], [{ sku: 'focus', displayName: 'Focus' }]);
  const unmapped = mapOrderLinesLocal({ product: 'Parche', quantity: 2 }, emptyMap);
  assert.equal(unmapped[0].sku, null);
  assert.equal(unmapped[0].qty, 2);
});

test('stock display names resolve even without a stored alias row', () => {
  const aliasMap = buildAliasMapFromRows([], [{ sku: 'focus', displayName: 'Focus' }]);
  const mapped = mapOrderLinesLocal({ product: 'Focus', quantity: 1 }, aliasMap);
  assert.equal(mapped[0].sku, 'focus');
  assert.equal(mapped[0].displayName, 'Focus');
});
