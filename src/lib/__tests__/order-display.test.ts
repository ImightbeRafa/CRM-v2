import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatOrderItems, orderItemLabels, orderItemsText } from '@/lib/orders/order-items';
import { isContraEntregaOrder, resolveShippingMethod } from '@/lib/orders/shipping-method';

const LONG = 'Parche Sleeping Melatonina Extra Fuerte Edición Limitada Noche Profunda 30 unidades';

describe('formatOrderItems', () => {
  it('uses productDetails, one line per item with quantity', () => {
    const lines = formatOrderItems({
      product: `${LONG}, Parche Focus`,
      quantity: 3,
      productDetails: JSON.stringify([
        { type: LONG, cantidad: 2, inventoryItemId: 'inv_1', sku: 'SLP-30' },
        { type: 'Parche Focus', cantidad: 1, color: 'Azul' },
      ]),
    });
    assert.deepEqual(lines.map((l) => l.label), [`2× ${LONG}`, '1× Parche Focus · Azul']);
    assert.equal(lines[0].name, LONG, 'never cuts the name');
  });

  it('accepts already-parsed and double-encoded productDetails', () => {
    const details = [{ name: 'Taza mágica', quantity: 4 }];
    assert.equal(formatOrderItems({ productDetails: details })[0].label, '4× Taza mágica');
    assert.equal(
      formatOrderItems({ productDetails: JSON.stringify(JSON.stringify(details)) })[0].label,
      '4× Taza mágica',
    );
  });

  it('skips variant values already in the name or too long', () => {
    const [line] = formatOrderItems({
      productDetails: [{ type: 'Taza Roja grande', color: 'roja', tamano: 'x'.repeat(41), cantidad: 1 }],
    });
    assert.equal(line.variant, null);
  });

  it('falls back to product text with the order quantity for a single item, name as written', () => {
    assert.deepEqual(formatOrderItems({ product: LONG, quantity: 2 }).map((l) => l.label), [`2× ${LONG}`]);
    assert.deepEqual(formatOrderItems({ product: 'Parche', quantity: null }).map((l) => l.label), ['Parche']);
    // "x30" / "30" / "2 en 1" are part of the product name, not the count.
    assert.deepEqual(formatOrderItems({ product: 'Parches Sleeping x30', quantity: 1 }).map((l) => l.label), ['1× Parches Sleeping x30']);
    assert.deepEqual(formatOrderItems({ product: '30 Parches Melatonina', quantity: 2 }).map((l) => l.label), ['2× 30 Parches Melatonina']);
    assert.deepEqual(formatOrderItems({ product: '2 en 1 Shampoo', quantity: 1 }).map((l) => l.label), ['1× 2 en 1 Shampoo']);
  });

  it('keeps decimal commas inside a name', () => {
    assert.deepEqual(formatOrderItems({ product: 'Pack 3,5 kg', quantity: 1 }).map((l) => l.label), ['1× Pack 3,5 kg']);
    assert.deepEqual(formatOrderItems({ product: 'Pack 3,5 kg, Taza', quantity: 2 }).map((l) => l.label), ['1× Pack 3,5 kg', '1× Taza']);
  });

  it('ignores productDetails that no longer match an edited order', () => {
    const details = JSON.stringify([{ type: 'Parche Sleeping', cantidad: 1 }]);
    // Product changed in Pedidos › Editar; productDetails was not rewritten.
    assert.deepEqual(formatOrderItems({ product: 'Parche Focus', quantity: 3, productDetails: details }).map((l) => l.label), ['3× Parche Focus']);
    // Same product, quantity edited.
    assert.deepEqual(formatOrderItems({ product: 'Parche Sleeping', quantity: 4, productDetails: details }).map((l) => l.label), ['4× Parche Sleeping']);
    assert.equal(orderItemLabels({ product: 'Parche Focus', quantity: 3, productDetails: details }), undefined);
    // Staff-bot label style ("name xN") still matches its details.
    assert.deepEqual(
      orderItemLabels({
        product: 'Parche Sleeping x2, Focus x1',
        quantity: 3,
        productDetails: JSON.stringify([{ type: 'Parche Sleeping', cantidad: 2 }, { type: 'Focus', cantidad: 1 }]),
      }),
      ['2× Parche Sleeping', '1× Focus'],
    );
  });

  it('splits comma-joined products without inventing quantities', () => {
    assert.deepEqual(
      formatOrderItems({ product: 'A, B, C', quantity: 3 }).map((l) => l.label),
      ['1× A', '1× B', '1× C'],
    );
    assert.deepEqual(
      formatOrderItems({ product: 'A, B', quantity: 5 }).map((l) => l.label),
      ['A', 'B'],
    );
    assert.deepEqual(
      formatOrderItems({ product: 'Parche x2; Focus (3)\n4 Calma', quantity: 9 }).map((l) => l.label),
      ['2× Parche', '3× Focus', '4× Calma'],
    );
    // Parsed counts that do not add up to the order quantity are not trusted.
    assert.deepEqual(
      formatOrderItems({ product: 'Parches x30, Taza x2', quantity: 3 }).map((l) => l.label),
      ['Parches x30', 'Taza x2'],
    );
  });

  it('ignores broken productDetails and empty input', () => {
    assert.deepEqual(formatOrderItems({ product: 'Parche', quantity: 1, productDetails: '{not json' }).map((l) => l.label), ['1× Parche']);
    assert.deepEqual(formatOrderItems({ product: '', productDetails: '[]' }), []);
    assert.deepEqual(formatOrderItems({}), []);
  });

  it('orderItemsText joins full labels with new lines', () => {
    assert.equal(orderItemsText({ product: 'A, B', quantity: 2 }), '1× A\n1× B');
  });
});

describe('resolveShippingMethod', () => {
  const label = (o: Parameters<typeof resolveShippingMethod>[0]) => resolveShippingMethod(o).label;

  it('pickup orders are Retiro whatever the carrier says', () => {
    assert.equal(label({ orderType: 'RA', courier: '' }), 'Retiro');
    assert.equal(label({ orderType: 'RA', lmCarrier: 'correos' }), 'Retiro');
    assert.equal(label({ orderType: 'RA', contraEntrega: true }), 'Retiro · Contra entrega');
  });

  it('logistics carrier wins over the sales courier text', () => {
    assert.equal(label({ orderType: 'EA', courier: 'Mensajero Juan', lmCarrier: 'correos' }), 'Correos');
    assert.equal(label({ orderType: 'EA', courier: 'Correos de CR', lmCarrier: 'mensajeria' }), 'Mensajería privada');
  });

  it('reads the sales courier text when logistics has not assigned', () => {
    assert.equal(label({ orderType: 'EA', courier: 'Correos de CR' }), 'Correos');
    assert.equal(label({ orderType: 'EA', courier: 'correos_cr' }), 'Correos');
    assert.equal(label({ orderType: 'EA', courier: 'CORREOS' }), 'Correos');
    assert.equal(label({ orderType: 'EA', courier: 'Mensajería' }), 'Mensajería privada');
    const uber = resolveShippingMethod({ orderType: 'EA', courier: 'Uber Flash' });
    assert.equal(uber.label, 'Mensajería privada');
    assert.equal(uber.courierName, 'Uber Flash');
    assert.equal(label({ orderType: 'EA', courier: 'Retiro en tienda' }), 'Retiro');
  });

  it('the COD default carrier "retiro" only counts when nothing else says how it ships', () => {
    assert.equal(label({ orderType: 'EA', courier: 'Correos', lmCarrier: 'retiro', isContraEntrega: true }), 'Correos · Contra entrega');
    assert.equal(label({ orderType: 'EA', courier: '', lmCarrier: 'retiro' }), 'Retiro');
    assert.equal(label({ orderType: 'EA', courier: 'manual', lmCarrier: 'retiro', isContraEntrega: true }), 'Contra entrega');
  });

  it('manual / empty couriers are unknown; COD alone still shows', () => {
    for (const placeholder of ['manual', 'n/a', '-', 'Por definir', 'Pendiente', 'Envío', 'ninguno']) {
      assert.equal(label({ orderType: 'EA', courier: placeholder }), 'Envío sin definir', placeholder);
    }
    assert.equal(label({}), 'Envío sin definir');
    assert.equal(label({ orderType: 'EA', contraEntrega: true }), 'Contra entrega');
  });

  it('detects COD from customFields.paymentStatus', () => {
    assert.equal(isContraEntregaOrder({ customFields: { paymentStatus: 'cod' } }), true);
    assert.equal(isContraEntregaOrder({ customFields: JSON.stringify({ paymentStatus: 'contra_entrega' }) }), true);
    assert.equal(isContraEntregaOrder({ customFields: { payment_status: 'cash_on_delivery' } }), true);
    assert.equal(isContraEntregaOrder({ customFields: { paymentStatus: 'paid' } }), false);
    assert.equal(label({ orderType: 'EA', courier: 'Correos', paymentStatus: 'COD' }), 'Correos · Contra entrega');
  });
});
