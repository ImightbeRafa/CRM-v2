import assert from 'node:assert/strict';
import {
  buildAliasMapFromRows,
  buildMappingSlots,
  extractOrderLines,
  mapOrderLinesLocal,
  normalizeProductName,
  orderContainsProductLabel,
  resolveSkuFromMap,
  shouldPersistGlobalAlias,
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

test('extractOrderLines splits mixed products instead of collapsing quantity', () => {
  assert.deepEqual(
    extractOrderLines({ product: '1 Dopa + 1 stress', quantity: 2 }),
    [
      { rawName: 'Dopa', qty: 1 },
      { rawName: 'stress', qty: 1 },
    ],
  );
  assert.deepEqual(
    extractOrderLines({ product: 'Dopamina, Estres', quantity: 2 }),
    [
      { rawName: 'Dopamina', qty: 1 },
      { rawName: 'Estres', qty: 1 },
    ],
  );
  assert.deepEqual(
    extractOrderLines({ product: 'Dopamina x1, Estres x1', quantity: 2 }),
    [
      { rawName: 'Dopamina', qty: 1 },
      { rawName: 'Estres', qty: 1 },
    ],
  );
});

test('extractOrderLines keeps two productDetails rows even when both are Parche', () => {
  const lines = extractOrderLines({
    product: 'Parche',
    quantity: 2,
    productDetails: JSON.stringify([
      { type: 'Parche', color: 'Dopamina', cantidad: 1 },
      { type: 'Parche', color: 'Estres', cantidad: 1 },
    ]),
  });
  assert.deepEqual(lines, [
    { rawName: 'Parche Dopamina', qty: 1 },
    { rawName: 'Parche Estres', qty: 1 },
  ]);
});

test('combined product labels do not fuzzy-match a single SKU', () => {
  const aliasMap = new Map<string, { sku: string; displayName: string }>([
    ['dopamina', { sku: 'dopamina', displayName: 'Dopamina' }],
    ['estres', { sku: 'estres', displayName: 'Estres' }],
  ]);
  assert.equal(resolveSkuFromMap('1 Dopa + 1 stress', aliasMap), null);
});

test('mapOrderLinesLocal maps mixed dopa + stress to two different SKUs', () => {
  const aliasMap = buildAliasMapFromRows(
    [
      { sku: 'dopamina', aliasNormalized: 'dopa', displayName: 'Dopamina' },
      { sku: 'estres', aliasNormalized: 'stress', displayName: 'Estres' },
    ],
    [
      { sku: 'dopamina', displayName: 'Dopamina' },
      { sku: 'estres', displayName: 'Estres' },
    ],
  );
  const mapped = mapOrderLinesLocal({ product: '1 Dopa + 1 stress', quantity: 2 }, aliasMap);
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0].sku, 'dopamina');
  assert.equal(mapped[0].qty, 1);
  assert.equal(mapped[1].sku, 'estres');
  assert.equal(mapped[1].qty, 1);
});

test('buildMappingSlots explodes generic Parche x2 into two independent unit pickers', () => {
  const slots = buildMappingSlots([
    { rawName: 'Parche', qty: 2, sku: 'dopamina', displayName: 'Dopamina' },
  ]);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].slotKey, '0:0');
  assert.equal(slots[1].slotKey, '0:1');
  assert.equal(slots[0].qty, 1);
  assert.equal(slots[1].qty, 1);
  assert.equal(slots[0].sku, null);
  assert.equal(slots[1].sku, null);

  const assigned = buildMappingSlots(
    [{ rawName: 'Parche', qty: 2, sku: null, displayName: null }],
    [
      { slotKey: '0:0', sku: 'dopamina', qty: 1, rawName: 'Parche', displayName: 'Dopamina' },
      { slotKey: '0:1', sku: 'estres', qty: 1, rawName: 'Parche', displayName: 'Estres' },
    ],
  );
  assert.equal(assigned[0].sku, 'dopamina');
  assert.equal(assigned[1].sku, 'estres');
});

test('extractOrderLines splits Dopa + Stress without explicit quantities', () => {
  assert.deepEqual(
    extractOrderLines({ product: 'Dopa + Stress', quantity: 2 }),
    [
      { rawName: 'Dopa', qty: 1 },
      { rawName: 'Stress', qty: 1 },
    ],
  );
  assert.deepEqual(
    extractOrderLines({ product: 'Dopa y Stress', quantity: 2 }),
    [
      { rawName: 'Dopa', qty: 1 },
      { rawName: 'Stress', qty: 1 },
    ],
  );
});

test('extractOrderLines splits bot-style patch lists with per-item qty', () => {
  const lines = extractOrderLines({
    product: 'DOPAMINE PATCH X1, ENERGY PATCH X1, GLP PATCH X2',
    quantity: 4,
  });
  assert.deepEqual(lines, [
    { rawName: 'DOPAMINE PATCH', qty: 1 },
    { rawName: 'ENERGY PATCH', qty: 1 },
    { rawName: 'GLP PATCH', qty: 2 },
  ]);
});

test('extractOrderLines accepts double-encoded productDetails JSON', () => {
  const inner = JSON.stringify([
    { type: 'Dopamina', cantidad: 1 },
    { type: 'Estres', cantidad: 1 },
  ]);
  const lines = extractOrderLines({
    product: 'Parche',
    quantity: 2,
    productDetails: JSON.stringify(inner),
  });
  assert.deepEqual(lines, [
    { rawName: 'Dopamina', qty: 1 },
    { rawName: 'Estres', qty: 1 },
  ]);
});

test('ambiguous Pura S does not pick a flavor SKU', () => {
  const aliasMap = buildAliasMapFromRows([], [
    { sku: 'pura_s_menta', displayName: 'Pura S Menta' },
    { sku: 'pura_s_sandia', displayName: 'Pura S Sandia' },
  ]);
  assert.equal(resolveSkuFromMap('Pura S', aliasMap), null);
  assert.equal(resolveSkuFromMap('Pura S Sandia', aliasMap)?.sku, 'pura_s_sandia');
});

test('named patch lines auto-map independently and sleeping x2 stays grouped', () => {
  const aliasMap = buildAliasMapFromRows(
    [
      { sku: 'dopamina', aliasNormalized: 'dopamine', displayName: 'Dopamina' },
      { sku: 'energia', aliasNormalized: 'energy', displayName: 'Energía' },
      { sku: 'sleeping', aliasNormalized: 'sleeping', displayName: 'Sleeping' },
    ],
    [
      { sku: 'dopamina', displayName: 'Dopamina' },
      { sku: 'energia', displayName: 'Energía' },
      { sku: 'sleeping', displayName: 'Sleeping' },
    ],
  );
  const mixed = mapOrderLinesLocal({
    product: 'dopamine patch x1, energy patch x1',
    quantity: 2,
  }, aliasMap);
  assert.equal(mixed[0].sku, 'dopamina');
  assert.equal(mixed[0].qty, 1);
  assert.equal(mixed[1].sku, 'energia');
  assert.equal(mixed[1].qty, 1);

  const sleeping = mapOrderLinesLocal({ product: 'Sleeping patches', quantity: 2 }, aliasMap);
  assert.equal(sleeping.length, 1);
  assert.equal(sleeping[0].sku, 'sleeping');
  assert.equal(sleeping[0].qty, 2);
  const sleepingSlots = buildMappingSlots(sleeping);
  assert.equal(sleepingSlots.length, 1);
  assert.equal(sleepingSlots[0].qty, 2);
});

test('two generic Parche rows ignore a shared alias so each unit can map differently', () => {
  const lines = [
    { rawName: 'Parche', qty: 1, sku: 'dopamina', displayName: 'Dopamina' },
    { rawName: 'Parche', qty: 1, sku: 'dopamina', displayName: 'Dopamina' },
  ];
  const slots = buildMappingSlots(lines);
  assert.equal(slots.length, 2);
  assert.equal(slots[0].sku, null);
  assert.equal(slots[1].sku, null);
  assert.equal(slots[0].slotKey, '0');
  assert.equal(slots[1].slotKey, '1');
});

test('shouldPersistGlobalAlias blocks generic Parche but allows named products', () => {
  assert.equal(shouldPersistGlobalAlias('Parche'), false);
  assert.equal(shouldPersistGlobalAlias('Dopamina'), true);
  assert.equal(shouldPersistGlobalAlias('Sleeping patches'), true);
});
