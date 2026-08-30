import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateOrderForm, draftProductAddBlockedReason } from '@/app/ventas/components/orderFormValidation';
import type { CustomerInfo, ProductInfo } from '@/app/ventas/components/types';

const customer: CustomerInfo = {
  name: '',
  phone: '',
  province: '',
  canton: '',
  district: '',
  email: '',
  username: '',
  address: '',
  business: '',
  funnel: '',
  comments: '',
  fechaEsperada: '',
  fechaRetiro: '',
  diaVenta: '',
  orderType: 'EA',
};

describe('order form validation', () => {
  it('returns every missing field at once', () => {
    const errors = validateOrderForm({
      customerInfo: customer,
      products: [],
      orderShippingMethod: '',
      businessInfoFields: [{ name: 'negocio', label: 'Negocio', required: true }],
    });
    assert.equal(errors.name, 'El nombre del cliente es requerido');
    assert.equal(errors.phone, 'El teléfono del cliente es requerido');
    assert.equal(errors.canton, 'El cantón es requerido para envíos. Elígelo de la lista.');
    assert.equal(errors.orderShippingMethod, 'La mensajería es requerida para envíos');
    assert.equal(errors.products, 'Debe agregar al menos un producto al pedido');
    assert.equal(errors['negocio'] === undefined, true);
    assert.ok(errors['business-negocio']);
  });

  it('does not require street address for pickup', () => {
    const errors = validateOrderForm({
      customerInfo: { ...customer, name: 'Ana', phone: '88887777', orderType: 'RA' },
      products: [{
        id: '1', type: 'Patch', color: '', packaging: '', comments: '', cantidad: 1,
        productCost: 5000, shippingCost: 0, iva: 0, total: 5000, vendedor: 'qa',
      } as ProductInfo],
      businessInfoFields: [],
    });
    assert.equal(Object.keys(errors).length, 0);
  });

  it('explains why Add stays disabled', () => {
    assert.equal(draftProductAddBlockedReason({ type: '', cantidad: 1, productCost: 0 }), 'Escribe el nombre del producto');
    assert.equal(draftProductAddBlockedReason({ type: 'Patch', cantidad: 1, productCost: 0 }), 'El precio unitario debe ser mayor a ₡0');
  });
});
