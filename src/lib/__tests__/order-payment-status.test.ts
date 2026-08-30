import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePaymentState, isCollectedRevenue } from '@/lib/order-payment-status';

describe('order-payment-status', () => {
  it('does not treat a Pendiente CRM order as collected', () => {
    const pending = {
      status: 'Pendiente',
      contraEntrega: false,
      cePaymentConfirmed: false,
      customFields: null,
    };
    const state = derivePaymentState(pending);
    assert.equal(state.key, 'pendiente_pago');
    assert.equal(state.collected, false);
    assert.equal(isCollectedRevenue(pending), false);
  });

  it('classifies the preview test order fixture as uncollected', () => {
    const fixture = {
      orderId: 'ORDER-1788038329933',
      status: 'Pendiente',
      contraEntrega: false,
      cePaymentConfirmed: false,
    };
    assert.equal(derivePaymentState(fixture).collected, false);
  });

  it('collects confirmed contra-entrega and explicit paid statuses', () => {
    assert.equal(derivePaymentState({
      status: 'Pendiente',
      contraEntrega: true,
      cePaymentConfirmed: true,
    }).collected, true);
    assert.equal(derivePaymentState({
      status: 'Pendiente',
      contraEntrega: false,
      customFields: { paymentStatus: 'paid' },
    }).key, 'pagado');
    assert.equal(derivePaymentState({
      status: 'Pendiente',
      contraEntrega: true,
      cePaymentConfirmed: false,
    }).key, 'contra_entrega');
  });

  it('keeps completed non-COD orders without payment metadata as collected', () => {
    assert.equal(derivePaymentState({
      status: 'Completado',
      contraEntrega: false,
    }).collected, true);
  });
});
