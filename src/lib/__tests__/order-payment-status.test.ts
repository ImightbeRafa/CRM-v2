import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { derivePaymentState, isCollectedRevenue, sinpeConfirmationPatch } from '@/lib/order-payment-status';

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

  it('confirms a pending website SINPE without touching shipping or the payment method', () => {
    const order = {
      status: 'Pendiente',
      contraEntrega: false,
      cePaymentConfirmed: false,
      comments: '',
      customFields: {
        external: true,
        source: 'Patch House Website',
        paymentMethod: 'SINPE',
        paymentStatus: 'pending',
        paymentTransactionId: 'txn-1',
      },
    };
    const decision = sinpeConfirmationPatch(order);
    assert.equal(decision.ok, true);
    if (!decision.ok) return;
    assert.equal(decision.customFields.paymentStatus, 'paid');
    assert.equal(decision.customFields.paymentMethod, 'SINPE');
    assert.equal(decision.customFields.source, 'Patch House Website');
    assert.equal(decision.customFields.external, true);
    assert.equal(decision.customFields.paymentTransactionId, 'txn-1');
    assert.equal(decision.previousStatus, 'pending');
    assert.equal(derivePaymentState({ ...order, customFields: decision.customFields }).key, 'pagado');
    assert.equal(derivePaymentState({ ...order, customFields: decision.customFields }).collected, true);
  });

  it('refuses COD, cancelled, non-SINPE, and an already paid SINPE', () => {
    assert.equal(sinpeConfirmationPatch({
      status: 'Pendiente',
      contraEntrega: true,
      comments: 'Pago: SINPE',
    }).ok, false);
    assert.equal(sinpeConfirmationPatch({
      status: 'Cancelado',
      contraEntrega: false,
      customFields: { paymentMethod: 'SINPE', paymentStatus: 'pending' },
    }).ok, false);
    assert.equal(sinpeConfirmationPatch({
      status: 'Pendiente',
      contraEntrega: false,
      customFields: { paymentMethod: 'tarjeta', paymentStatus: 'pending' },
    }).ok, false);
    const paid = sinpeConfirmationPatch({
      status: 'Pendiente',
      contraEntrega: false,
      customFields: { paymentMethod: 'SINPE', paymentStatus: 'paid' },
    });
    assert.equal(paid.ok, false);
    if (!paid.ok) assert.equal(paid.code, 'already_paid');
  });

  it('keeps completed non-COD orders without payment metadata as collected', () => {
    assert.equal(derivePaymentState({
      status: 'Completado',
      contraEntrega: false,
    }).collected, true);
  });
});
