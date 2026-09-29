/** Phase 2a client lifecycle engine (2026-09-29): pure rules + manual stickiness. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveClientStage, orderPhase, resolveClientStage, type StageOrder } from '../crm-client-stage'

let n = 0
const order = (o: Partial<StageOrder>): StageOrder => ({
  id: `o${++n}`,
  status: 'Pendiente',
  timestamp: new Date(Date.UTC(2026, 0, n)),
  contraEntrega: false,
  cePaymentConfirmed: false,
  customFields: null,
  hasGuia: false,
  ...o,
})

test('no orders: Nuevo lead, or Cotizando once the team replied', () => {
  assert.equal(deriveClientStage({ orders: [], humanReplied: false }).key, 'nuevo_lead')
  assert.equal(deriveClientStage({ orders: [], humanReplied: true }).key, 'cotizando')
})

test('open order drives the stage', () => {
  assert.equal(deriveClientStage({ orders: [order({})], humanReplied: true }).key, 'esperando_pago')
  assert.equal(deriveClientStage({ orders: [order({ customFields: { paymentStatus: 'pagado' } })], humanReplied: false }).key, 'pagado')
  assert.equal(deriveClientStage({ orders: [order({ contraEntrega: true })], humanReplied: false }).key, 'pagado')
  assert.equal(deriveClientStage({ orders: [order({ status: 'En-Proceso' })], humanReplied: false }).key, 'en_produccion')
  assert.equal(deriveClientStage({ orders: [order({ status: 'Urgente' })], humanReplied: false }).key, 'en_produccion')
  assert.equal(deriveClientStage({ orders: [order({ hasGuia: true })], humanReplied: false }).key, 'enviado')
  assert.equal(deriveClientStage({ orders: [order({ status: 'Enviado' })], humanReplied: false }).key, 'enviado')
})

test('Entregado after one delivered order; Recurrente after 2+ purchases (Rafael)', () => {
  assert.equal(deriveClientStage({ orders: [order({ status: 'Entregado' })], humanReplied: false }).key, 'entregado')
  assert.equal(deriveClientStage({ orders: [order({ status: 'Entregado' }), order({ status: 'Entregado' })], humanReplied: false }).key, 'recurrente')
  // An active new order of a repeat customer shows where that order is.
  const active = deriveClientStage({ orders: [order({ status: 'Entregado' }), order({ status: 'Entregado' }), order({})], humanReplied: false })
  assert.equal(active.key, 'esperando_pago')
})

test('cancelled orders are ignored', () => {
  assert.equal(orderPhase({ status: 'Cancelado', hasGuia: true }), 'cancelled')
  assert.equal(deriveClientStage({ orders: [order({ status: 'Cancelado' })], humanReplied: false }).key, 'nuevo_lead')
})

test('fingerprint changes with evidence, not with time', () => {
  const o = order({})
  const a = deriveClientStage({ orders: [o], humanReplied: false })
  const b = deriveClientStage({ orders: [o], humanReplied: false })
  assert.equal(a.fingerprint, b.fingerprint)
  const paid = deriveClientStage({ orders: [{ ...o, customFields: { paymentStatus: 'pagado' } }], humanReplied: false })
  assert.notEqual(a.fingerprint, paid.fingerprint)
})

test('manual stage sticks until the evidence changes', () => {
  const d = deriveClientStage({ orders: [order({})], humanReplied: false })
  const manual = { stageKey: 'cotizando', source: 'manual', fingerprint: d.fingerprint }
  assert.deepEqual(resolveClientStage(d, manual), { key: 'cotizando', source: 'manual', changed: false })
  const moved = deriveClientStage({ orders: [order({ hasGuia: true })], humanReplied: false })
  assert.equal(resolveClientStage(moved, manual).key, 'enviado')
  assert.equal(resolveClientStage(moved, manual).changed, true)
  assert.equal(resolveClientStage(d, { stageKey: d.key, source: 'auto', fingerprint: d.fingerprint }).changed, false, 'no write when nothing changed')
})
