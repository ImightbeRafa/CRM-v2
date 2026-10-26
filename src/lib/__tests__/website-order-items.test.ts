import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWebsiteItems, websiteItemsDetails } from '@/lib/orders/website-items';
import { formatOrderItems, orderItemLabels, webCommentItems } from '@/lib/orders/order-items';
import { extractInventoryRequests } from '@/lib/order-lifecycle';
import { extractOrderLines } from '@/lib/retiro-stock-utils';
import { buildGuiaDescription } from '@/lib/correos/utils';
import { externalOrderIntakeSchema } from '@/lib/website-order-schema';

const PLACEHOLDER = 'Pedido múltiple (2 productos)';
const cart = [
  { name: 'Arnés ForgeCR · Talla M/L', quantity: 1, unitPrice: '₡14 900', lineTotal: '₡14 900', sku: 'ARN-ML' },
  { name: 'Correa ForgeCR', quantity: 1, unitPrice: '₡12 000' },
];

// Comment exactly as ForgeCR/PatchHouse wrote it before the `items` intake (#2268).
const FORGE_COMMENT = [
  'Pago: Tarjeta (Tilopay) - Estado: PAGADO - ID Transacción: 123',
  'Productos:',
  'Arnés ForgeCR · Talla M/L x1 — ₡14 900',
  'Correa ForgeCR x1 — ₡12 000',
  'Comentarios del cliente: entregar en la tarde x2',
].join('\n');

describe('website cart intake', () => {
  it('reads items leniently and never half a cart', () => {
    const items = parseWebsiteItems(cart);
    assert.deepEqual(items?.map((i) => [i.name, i.quantity, i.unitPrice, i.lineTotal]), [
      ['Arnés ForgeCR · Talla M/L', 1, 14900, 14900],
      ['Correa ForgeCR', 1, 12000, undefined],
    ]);
    assert.equal(parseWebsiteItems([...cart, { name: '', quantity: 1 }]), undefined);
    assert.equal(parseWebsiteItems([{ name: 'A', quantity: 1.5 }]), undefined);
    assert.equal(parseWebsiteItems('nope'), undefined);
    assert.equal(parseWebsiteItems(Array.from({ length: 51 }, () => ({ name: 'A', quantity: 1 }))), undefined);
  });

  it('Pura Sonrisa lineItems with flavors become a variant', () => {
    const [item] = parseWebsiteItems([{ name: 'Combo', quantity: 2, unitPrice: '9950', flavors: ['Menta', 'Blue'] }])!;
    assert.equal(item.variant, 'Menta + Blue');
  });

  it('the schema keeps old payloads valid and passes items through', () => {
    const base = {
      orderId: 'ORD-1', customer: { name: 'Ana', phone: '88887777' },
      product: { name: PLACEHOLDER, quantity: 2, unitPrice: '₡26 900' },
      shipping: { cost: '0', address: { province: 'Cartago', canton: 'Paraíso', district: 'Santa Lucía', fullAddress: 'Casa 1' } },
      total: '₡26 900',
    };
    assert.equal(externalOrderIntakeSchema.safeParse(base).success, true);
    const withItems = externalOrderIntakeSchema.safeParse({ ...base, items: cart });
    assert.equal(withItems.success, true);
    assert.deepEqual(withItems.success && withItems.data.items, cart);
    // A broken list is ignored later, never a rejected order.
    assert.equal(externalOrderIntakeSchema.safeParse({ ...base, items: 'garbage' }).success, true);
  });

  it('only a cart of 2+ items writes details', () => {
    assert.equal(websiteItemsDetails('Arnés', parseWebsiteItems([cart[0]])), null);
    assert.equal(websiteItemsDetails(PLACEHOLDER, undefined), null);
    assert.notEqual(websiteItemsDetails(PLACEHOLDER, parseWebsiteItems(cart)), null);
  });
});

describe('website cart rows are display-only', () => {
  const details = websiteItemsDetails(PLACEHOLDER, parseWebsiteItems(cart))!;
  const order = { product: PLACEHOLDER, quantity: 2, productDetails: details };

  it('shows one line per item with its count', () => {
    assert.deepEqual(formatOrderItems(order).map((l) => l.label), ['1× Arnés ForgeCR · Talla M/L', '1× Correa ForgeCR']);
    assert.deepEqual(orderItemLabels(order), ['1× Arnés ForgeCR · Talla M/L', '1× Correa ForgeCR']);
  });

  it('trusts the rows even when the site counts differently (bags, boxes)', () => {
    assert.equal(orderItemLabels({ ...order, quantity: 7 })?.length, 2);
  });

  it('stops trusting them once the product is edited', () => {
    assert.equal(orderItemLabels({ ...order, product: 'Arnés ForgeCR' }), undefined);
    assert.deepEqual(formatOrderItems({ ...order, product: 'Arnés ForgeCR', quantity: 1 }).map((l) => l.label), ['1× Arnés ForgeCR']);
  });

  it('inventory stock reads exactly what it read before (the product text)', () => {
    assert.deepEqual(extractInventoryRequests(order), extractInventoryRequests({ product: PLACEHOLDER, quantity: 2 }));
    assert.deepEqual(extractInventoryRequests(order), [{ key: PLACEHOLDER, quantity: 2 }]);
  });

  it('retiro stock reads exactly what it read before', () => {
    assert.deepEqual(extractOrderLines(order), extractOrderLines({ product: PLACEHOLDER, quantity: 2 }));
  });

  it('the Correos guía lists the items', () => {
    assert.equal(buildGuiaDescription(order), 'Arnés ForgeCR · Talla M/L, Correa ForgeCR');
    assert.equal(buildGuiaDescription({ ...order, product: 'Otro', quantity: 3 }), 'Otro (x3)');
  });
});

describe('older website orders: items from the notes', () => {
  const old = { product: PLACEHOLDER, quantity: 2, comments: FORGE_COMMENT };

  it('reads the Productos: block and stops at the customer comment', () => {
    assert.deepEqual(webCommentItems(old).map((l) => l.label), ['1× Arnés ForgeCR · Talla M/L', '1× Correa ForgeCR']);
    assert.deepEqual(orderItemLabels(old), ['1× Arnés ForgeCR · Talla M/L', '1× Correa ForgeCR']);
    assert.equal(buildGuiaDescription(old), 'Arnés ForgeCR · Talla M/L, Correa ForgeCR');
  });

  it('reads " | " segments without a header (Pura Sonrisa / Prototipo)', () => {
    const pura = {
      product: 'Pedido múltiple (2 productos)',
      quantity: 3,
      comments: 'Metodo de pago: Tilopay - PAGADO | Combo Pura Sonrisa (Menta + Blue Raspberry) x2 | Pasta x1 | Comentarios del cliente: hola x3',
    };
    assert.deepEqual(webCommentItems(pura).map((l) => l.label), ['2× Combo Pura Sonrisa (Menta + Blue Raspberry)', '1× Pasta']);
  });

  it('keeps names that contain " x"', () => {
    const lines = webCommentItems({ product: PLACEHOLDER, comments: 'Productos:\nPack x3 Promo x2 — ₡1 000\nOtro x1 — ₡500' });
    assert.deepEqual(lines.map((l) => [l.name, l.qty]), [['Pack x3 Promo', 2], ['Otro', 1]]);
  });

  it('never reads ordinary notes as items', () => {
    assert.deepEqual(webCommentItems({ product: 'Parche Sleep', quantity: 1, comments: 'Cliente quiere x2 bolsas' }), []);
    // A real product with a Productos: block only when it adds up to the order quantity.
    const sleep = { product: 'Sleeping Patches CR · 3 bolsas', comments: 'Productos:\nBolsa A x1 — ₡1\nBolsa B x2 — ₡2' };
    assert.equal(webCommentItems({ ...sleep, quantity: 3 }).length, 2);
    assert.deepEqual(webCommentItems({ ...sleep, quantity: 5 }), []);
    assert.deepEqual(webCommentItems({ product: PLACEHOLDER, comments: '' }), []);
  });

  it('trusted productDetails still win over the notes', () => {
    const ventas = {
      product: 'Parche Focus',
      quantity: 1,
      productDetails: JSON.stringify([{ type: 'Parche Focus', cantidad: 1 }]),
      comments: 'Productos:\nOtra cosa x1 — ₡1',
    };
    assert.deepEqual(formatOrderItems(ventas).map((l) => l.label), ['1× Parche Focus']);
  });
});
