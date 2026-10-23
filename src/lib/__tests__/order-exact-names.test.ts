/**
 * Lane J — exact product names on orders. Display-only by design: the exact item travels in `itemName` +
 * `inventoryItemId`, which stock matching ignores, so no order that goes through today can start failing with
 * INSUFFICIENT_STOCK. These tests pin both halves: what people see, and what the stock matchers see.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatOrderItems, orderItemLabels } from '../orders/order-items';
import { exactItemDetail, pickedItemFields, websiteProductDetails } from '../orders/exact-item';
import { applyItemNames, inventoryIdsNeedingNames } from '../orders/item-names-server';
import { fillItemNames, genericLines, inventoryNames, isGenericName } from '../orders/generic-product';
import { extractInventoryRequests } from '../order-lifecycle';
import { extractOrderLines } from '../retiro-stock-utils';

const src = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n');

// What the Ventas form now writes for a quick-pick of "Parche Sleep · 30 u" (category "Parche").
const ventasDetails = JSON.stringify([
  { type: 'Parche', cantidad: 2, color: '', tamano: '', productCost: 9000, inventoryItemId: 'inv_sleep30', itemName: 'Parche Sleep · 30 u' },
]);

describe('display: exact item name wins over the generic word', () => {
  it('shows the picked item instead of "Parche"', () => {
    const order = { product: 'Parche', quantity: 2, productDetails: ventasDetails };
    assert.deepEqual(formatOrderItems(order).map((l) => l.label), ['2× Parche Sleep · 30 u']);
    assert.deepEqual(orderItemLabels(order), ['2× Parche Sleep · 30 u']);
  });
  it('several lines: product text built from stored names still validates the details', () => {
    const details = JSON.stringify([
      { type: 'Parche', cantidad: 1, itemName: 'Parche Sleep · 30 u', inventoryItemId: 'a' },
      { type: 'Parche', cantidad: 2, itemName: 'Dopamine Patch', inventoryItemId: 'b' },
    ]);
    const lines = formatOrderItems({ product: 'Parche, Parche', quantity: 3, productDetails: details });
    assert.deepEqual(lines.map((l) => l.label), ['1× Parche Sleep · 30 u', '2× Dopamine Patch']);
  });
  it('stale details (order edited afterwards) still fall back to the product text', () => {
    const lines = formatOrderItems({ product: 'Parche Focus', quantity: 2, productDetails: ventasDetails });
    assert.deepEqual(lines.map((l) => l.label), ['2× Parche Focus']);
  });
  it('orders without itemName look exactly as before', () => {
    const old = JSON.stringify([{ type: 'Parche Sleeping Melatonina 30u', cantidad: 2 }]);
    assert.deepEqual(formatOrderItems({ product: 'Parche Sleeping Melatonina 30u', quantity: 2, productDetails: old }).map((l) => l.label), ['2× Parche Sleeping Melatonina 30u']);
  });
});

describe('stock matching is unchanged (no new INSUFFICIENT_STOCK rejections)', () => {
  it('lifecycle matcher still keys on `type` (the category), never itemName / inventoryItemId', () => {
    assert.deepEqual(extractInventoryRequests({ productDetails: ventasDetails, product: 'Parche', quantity: 2 }), [{ key: 'Parche', quantity: 2 }]);
  });
  it('website details with a SKU give the matcher the same key and count as the bare product text', () => {
    for (const product of [{ name: 'Parche Sleep', quantity: 1 }, { name: '  Dopamine Patch ', quantity: 3 }]) {
      const details = websiteProductDetails(product, { id: 'inv_1', name: 'Dopamine Patch 30u' });
      assert.ok(details);
      assert.deepEqual(
        extractInventoryRequests({ productDetails: details, product: product.name, quantity: product.quantity }),
        extractInventoryRequests({ product: product.name, quantity: product.quantity }),
      );
      assert.equal(JSON.parse(details)[0].itemName, 'Dopamine Patch 30u');
      assert.equal(JSON.parse(details)[0].sku, undefined, 'never writes sku (the matcher would prefer it)');
    }
  });
  it('website: no details when parity cannot be guaranteed (comma, fraction, no unique match)', () => {
    assert.equal(websiteProductDetails({ name: 'Parche, Crema', quantity: 1 }, { id: 'i', name: 'X' }), null);
    assert.equal(websiteProductDetails({ name: 'Parche', quantity: 1.5 }, { id: 'i', name: 'X' }), null);
    assert.equal(websiteProductDetails({ name: 'Parche', quantity: 1 }, null), null);
  });
  it('retiro lines ignore the new keys (no "Parche Sleep · 30 u" glued onto the line as an extra)', () => {
    const lines = extractOrderLines({ product: 'Parche', quantity: 2, productDetails: ventasDetails });
    assert.deepEqual(lines, [{ rawName: 'Parche', qty: 2 }]);
  });
  it('legacy deduction input keeps `type` (route.ts updateInventoryForProduct reads type)', () => {
    const route = src('src/app/api/orders/route.ts');
    assert.match(route, /const \{ type, cantidad, color, tamano \} = product/);
  });
});

describe('Ventas form carries the exact item', () => {
  it('quick-pick keeps the inventory id + name next to the category', () => {
    assert.deepEqual(pickedItemFields({ id: 'inv_1', name: ' Parche Sleep · 30 u ' }, 'Parche'), {
      inventoryItemId: 'inv_1', itemName: 'Parche Sleep · 30 u', pickedType: 'Parche',
    });
    assert.deepEqual(pickedItemFields({ id: '', name: 'X' }, 'Parche'), {});
    assert.deepEqual(pickedItemFields({ id: 'x'.repeat(65), name: 'X' }, 'Parche'), {});
  });
  it('a line renamed after picking drops the stale item', () => {
    const picked = { type: 'Parche', ...pickedItemFields({ id: 'inv_1', name: 'Parche Sleep' }, 'Parche') };
    assert.deepEqual(exactItemDetail(picked), { inventoryItemId: 'inv_1', itemName: 'Parche Sleep' });
    assert.deepEqual(exactItemDetail({ ...picked, type: 'Crema' }), {});
    assert.deepEqual(exactItemDetail({ type: 'Manual' }), {});
  });
  it('the form writes itemName/inventoryItemId into productDetails, keeps type, never sku', () => {
    const form = src('src/app/ventas/components/EnhancedSalesForm.tsx');
    assert.match(form, /type: p\.type,\n\s+cantidad: p\.cantidad,[\s\S]{0,120}\.\.\.exactItemDetail\(p\)/);
    assert.match(form, /\.\.\.pickedItemFields\(\{ id: productTemplate\.id, name: productTemplate\.name \}, productTemplate\.type\)/);
    assert.match(form, /\.\.\.pickedItemFields\(\{ id: p\.id, name: p\.name \}, p\.type\)/);
    assert.match(form, /'inventoryItemId', 'itemName', 'pickedType'\]\)/, 'never copied into order customFields');
    assert.match(src('src/app/ventas/components/EnhancedSmartSuggestions.tsx'), /type: item\.category,/, 'stock key unchanged');
  });
  it('website schema accepts an optional sku; the lookup is scoped to the business and active items', () => {
    assert.match(src('src/lib/website-order-schema.ts'), /sku: z\.preprocess\(/);
    assert.match(src('src/lib/integration-orders.ts'), /where: \{ tenantId, isActive: true, sku: \{ equals: escaped, mode: 'insensitive' \} \},[\s\S]{0,80}take: 2/);
  });
});

describe('display lookup by inventoryItemId (same business only)', () => {
  const rows = [
    { id: 'o1', productDetails: JSON.stringify([{ type: 'Parche', cantidad: 1, inventoryItemId: 'inv_a' }]) },
    { id: 'o2', productDetails: JSON.stringify([{ type: 'Parche', cantidad: 1, inventoryItemId: 'inv_b', itemName: 'Saved' }]) },
    { id: 'o3', productDetails: null },
  ];
  it('asks only for ids without a saved name', () => {
    assert.deepEqual(inventoryIdsNeedingNames(rows), ['inv_a']);
  });
  it('fills the current name, never overrides a saved one, leaves other rows as they are', () => {
    const out = applyItemNames(rows, new Map([['inv_a', 'Parche Sleep'], ['inv_b', 'Renamed later']]));
    assert.equal(JSON.parse(out[0].productDetails as string)[0].itemName, 'Parche Sleep');
    assert.equal(out[1], rows[1]);
    assert.equal(out[2], rows[2]);
  });
  it('the server helper looks items up with the caller tenant', () => {
    assert.match(src('src/lib/orders/item-names-server.ts'), /where: \{ tenantId, id: \{ in: ids \} \}/);
  });
});

describe('generic-name report + safe backfill', () => {
  const inv = inventoryNames([
    { name: 'Parche Sleep · 30 u', category: 'Parche' },
    { name: 'Dopamine Patch', category: 'Parche' },
    { name: 'Crema', category: 'Crema' },
  ]);
  it('generic: known generic words and categories that are not item names', () => {
    assert.equal(isGenericName('1x Parche', inv), true);
    assert.equal(isGenericName('Parche x2', inv), true);
    assert.equal(isGenericName('Producto', inv), true);
    assert.equal(isGenericName('Parche Sleep · 30 u', inv), false);
    assert.equal(isGenericName('Crema', inv), false, 'category that is also an item name is specific');
  });
  it('per order: details lines with itemName are not generic; text orders are split', () => {
    assert.deepEqual(genericLines({ product: 'Parche', productDetails: ventasDetails }, inv), []);
    assert.deepEqual(genericLines({ product: '1x Parche, Dopamine Patch', productDetails: null }, inv), ['1x Parche']);
    assert.deepEqual(genericLines({ product: 'Parche', productDetails: JSON.stringify([{ type: 'Parche', cantidad: 1 }]) }, inv), ['Parche']);
  });
  it('backfill fills itemName only from a resolved id, and nothing else changes', () => {
    const raw = JSON.stringify([{ type: 'Parche', cantidad: 1, inventoryItemId: 'a', requestedSku: 'S' }, { type: 'Crema', cantidad: 1 }]);
    const next = fillItemNames(raw, new Map([['a', 'Parche Sleep']]));
    assert.deepEqual(JSON.parse(next as string), [
      { type: 'Parche', cantidad: 1, inventoryItemId: 'a', requestedSku: 'S', itemName: 'Parche Sleep' },
      { type: 'Crema', cantidad: 1 },
    ]);
    assert.equal(fillItemNames(raw, new Map()), null, 'unknown id (or another business) → untouched');
    assert.equal(fillItemNames(next, new Map([['a', 'Other']])), null, 'idempotent');
    assert.equal(fillItemNames(JSON.stringify([{ inventoryItemId: 'a' }, 'junk']), new Map([['a', 'X']])), null, 'malformed arrays are left alone');
  });
  it('report is read-only and backfills need explicit host-confirmed apply', () => {
    assert.match(src('scripts/order-names-report.ts'), /default_transaction_read_only: true/);
    const names = src('scripts/order-item-names-backfill.ts');
    assert.match(names, /ORDER_ITEM_NAMES_BACKFILL_APPLY !== '1'/);
    assert.match(names, /"tenantId" = \$\{tenantId\} AND "id" = ANY/);
    assert.match(names, /AND "productDetails" = \$\{row\.productDetails\}/);
    const numbers = src('scripts/order-number-backfill.ts');
    assert.match(numbers, /ORDER_NUMBER_BACKFILL_APPLY !== '1'/);
    assert.match(numbers, /confirmHost !== host/);
  });
});

describe('review fixes (website intake)', () => {
  it('a bad sku never rejects a website order (treated as "no sku", as before)', async () => {
    const { externalOrderIntakeSchema } = await import('../website-order-schema');
    const base = {
      orderId: 'W-1', orderType: 'RA', customer: { name: 'Ana', phone: '88881111' }, total: '1000',
      product: { name: 'Parche Sleep', quantity: 1, unitPrice: '1000' },
    };
    for (const sku of ['', '   ', null, 123, 'x'.repeat(65), { a: 1 }]) {
      const parsed = externalOrderIntakeSchema.safeParse({ ...base, product: { ...base.product, sku } });
      assert.equal(parsed.success, true, JSON.stringify(sku));
      assert.equal(parsed.success && parsed.data.product.sku, undefined);
    }
    const ok = externalOrderIntakeSchema.safeParse({ ...base, product: { ...base.product, sku: ' SLP-30 ' } });
    assert.equal(ok.success && ok.data.product.sku, 'SLP-30');
  });
  it('website details are skipped when retiro would read the order differently', () => {
    for (const name of ['Parche Sleep x2', 'A + B', 'A y B', 'A; B']) {
      assert.equal(websiteProductDetails({ name, quantity: 1 }, { id: 'i', name: 'X' }), null, name);
    }
    const details = websiteProductDetails({ name: 'Parche Sleep', quantity: 2 }, { id: 'i', name: 'Parche Sleep · 30 u' });
    assert.ok(details);
    assert.deepEqual(
      extractOrderLines({ product: 'Parche Sleep', quantity: 2, productDetails: details }),
      extractOrderLines({ product: 'Parche Sleep', quantity: 2 }),
    );
  });
  it('sku lookup escapes ILIKE wildcards and re-checks the exact match', () => {
    const code = src('src/lib/integration-orders.ts');
    assert.ok(code.includes('sku.replace(/[\\\\%_]/g'), 'escapes % _ and backslash');
    assert.match(code, /row\.sku\.toLowerCase\(\) === sku\.toLowerCase\(\)/);
  });
  it('Pedido drawer shows the exact item name', () => {
    assert.match(src('src/components/aurora/pedidos/PedidoDetailDrawer.tsx'), /p\.itemName\.trim\(\)\) \|\| p\.type \|\| 'Producto'/);
  });
});
