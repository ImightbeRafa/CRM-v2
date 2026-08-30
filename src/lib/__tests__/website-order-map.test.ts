import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapWebsiteOrderCreate } from '../website-order-map';
import { externalOrderIntakeSchema } from '../website-order-schema';
import type { ExternalOrderData } from '@/types/integration';

const shipping = {
  cost: '₡2.500',
  courier: 'Correos',
  address: {
    province: 'San José',
    canton: 'Central',
    district: 'Carmen',
    fullAddress: 'Calle 1',
  },
};

const base = {
  orderId: 'WEB-1',
  customer: { name: 'Ana', phone: '88887777' },
  product: { name: 'Bolso', quantity: 1, unitPrice: '₡3.000' },
  total: '₡5.500',
};

describe('website order intake', () => {
  it('keeps omitted orderType as Envío with address intact', () => {
    const parsed = externalOrderIntakeSchema.parse({ ...base, shipping });
    const mapped = mapWebsiteOrderCreate(parsed as ExternalOrderData);
    assert.equal(mapped.orderType, 'EA');
    assert.equal(mapped.total, 5500);
    assert.equal(mapped.shippingCost, 2500);
    assert.equal(mapped.address, 'Calle 1');
    assert.equal(mapped.courier, 'Correos');
  });

  it('rejects Envío payloads that omit shipping', () => {
    const result = externalOrderIntakeSchema.safeParse(base);
    assert.equal(result.success, false);
  });

  it('accepts explicit RA pickup without address and does not infer RA from free shipping', () => {
    const pickup = externalOrderIntakeSchema.parse({
      ...base,
      orderType: 'RA',
      pickupDate: '2026-09-01',
      total: '₡3.000',
    });
    const mapped = mapWebsiteOrderCreate(pickup as ExternalOrderData);
    assert.equal(mapped.orderType, 'RA');
    assert.equal(mapped.shippingCost, 0);
    assert.equal(mapped.address, '');
    assert.equal(mapped.courier, '');
    assert.equal(mapped.pickupDate, '2026-09-01');
    assert.equal(mapped.total, 3000);

    const freeShipping = mapWebsiteOrderCreate({
      ...base,
      shipping: { ...shipping, cost: 'GRATIS' },
    });
    assert.equal(freeShipping.orderType, 'EA');
    assert.equal(freeShipping.shippingCost, 0);
    assert.equal(freeShipping.address, 'Calle 1');
  });
});
