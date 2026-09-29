/** Phase 2a client lifecycle engine (2026-09-29): pure rules v2 + manual stickiness. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveClientStage, orderPhase, resolveClientStage, STALE_OPEN_DAYS, type StageOrder } from '../crm-client-stage'

// Fixed clock: fixtures are dated relative to NOW so the 45-day stale rule is deterministic.
const NOW = new Date(Date.UTC(2026, 8, 29))
const DAY = 24 * 60 * 60 * 1000
let n = 0
const order = (o: Partial<StageOrder> & { daysAgo?: number }): StageOrder => {
  const { daysAgo, ...rest } = o
  n++
  return {
    id: `o${n}`,
    status: 'Pendiente',
    // Later fixtures are newer by default.
    timestamp: new Date(NOW.getTime() - (daysAgo ?? 30 - n * 0.01) * DAY),
    contraEntrega: false,
    cePaymentConfirmed: false,
    customFields: null,
    hasGuia: false,
    ...rest,
  }
}
const derive = (orders: StageOrder[], humanReplied = false) => deriveClientStage({ orders, humanReplied }, NOW)

test('no orders: Nuevo lead, or Cotizando once the team replied', () => {
  assert.equal(derive([], false).key, 'nuevo_lead')
  assert.equal(derive([], true).key, 'cotizando')
})

test('open order drives the stage', () => {
  assert.equal(derive([order({})], true).key, 'esperando_pago')
  assert.equal(derive([order({ customFields: { paymentStatus: 'pagado' } })]).key, 'pagado')
  assert.equal(derive([order({ contraEntrega: true })]).key, 'pagado')
  assert.equal(derive([order({ status: 'En-Proceso' })]).key, 'en_produccion')
  assert.equal(derive([order({ status: 'Urgente' })]).key, 'en_produccion')
  assert.equal(derive([order({ hasGuia: true })]).key, 'enviado')
  assert.equal(derive([order({ status: 'Enviado' })]).key, 'enviado')
})

test('Entregado after one delivered order; Recurrente after 2+ purchases (Rafael)', () => {
  assert.equal(derive([order({ status: 'Entregado' })]).key, 'entregado')
  const two = derive([order({ status: 'Entregado', daysAgo: 20 }), order({ status: 'Entregado', daysAgo: 10 })])
  assert.equal(two.key, 'recurrente')
  assert.equal(two.repeatCustomer, true)
  // A new order of a repeat customer shows where that order is, and keeps the repeat signal.
  const active = derive([order({ status: 'Entregado', daysAgo: 20 }), order({ status: 'Entregado', daysAgo: 10 }), order({ daysAgo: 1 })])
  assert.equal(active.key, 'esperando_pago')
  assert.equal(active.repeatCustomer, true)
  assert.equal(derive([order({ status: 'Entregado' })]).repeatCustomer, false)
})

test('Completado (walk-in sale, picked-up RA) is a finished purchase', () => {
  assert.equal(derive([order({ status: 'Completado' })]).key, 'entregado')
  assert.equal(derive([order({ status: 'Completado', daysAgo: 20 }), order({ status: 'Completado', daysAgo: 5 })]).key, 'recurrente')
  assert.equal(orderPhase({ status: 'Anulada', hasGuia: false, terminal: true }), 'cancelled')
})

test('a status the business marked terminal counts as finished', () => {
  assert.equal(orderPhase({ status: 'Retirado', hasGuia: false, terminal: true }), 'delivered')
  assert.equal(derive([order({ status: 'Retirado', terminal: true })]).key, 'entregado')
})

test(`open orders older than ${STALE_OPEN_DAYS} days stop driving the stage`, () => {
  assert.equal(derive([order({ daysAgo: STALE_OPEN_DAYS + 1 })], true).key, 'cotizando', 'abandoned unpaid order')
  assert.equal(derive([order({ daysAgo: STALE_OPEN_DAYS - 1 })], true).key, 'esperando_pago')
})

test('an open order older than the last finished one does not pin the client', () => {
  const s = derive([order({ status: 'En-Proceso', daysAgo: 20 }), order({ status: 'Entregado', daysAgo: 5 })])
  assert.notEqual(s.key, 'en_produccion')
})

test('cancelled orders are ignored', () => {
  assert.equal(orderPhase({ status: 'Cancelado', hasGuia: true }), 'cancelled')
  assert.equal(derive([order({ status: 'Cancelado' })]).key, 'nuevo_lead')
})

test('fingerprint changes with evidence, not with time', () => {
  const o = order({ daysAgo: 3 })
  const a = derive([o])
  const b = deriveClientStage({ orders: [o], humanReplied: false }, new Date(NOW.getTime() + DAY))
  assert.equal(a.fingerprint, b.fingerprint)
  const paid = derive([{ ...o, customFields: { paymentStatus: 'pagado' } }])
  assert.notEqual(a.fingerprint, paid.fingerprint)
  assert.match(a.fingerprint, /^2\|/, 'rules version 2 in the fingerprint')
})

test('manual stage sticks until the evidence changes', () => {
  const d = derive([order({})])
  const manual = { stageKey: 'cotizando', source: 'manual', fingerprint: d.fingerprint }
  assert.deepEqual(resolveClientStage(d, manual), { key: 'cotizando', source: 'manual', changed: false })
  const moved = derive([order({ hasGuia: true })])
  assert.equal(resolveClientStage(moved, manual).key, 'enviado')
  assert.equal(resolveClientStage(moved, manual).changed, true)
  assert.equal(resolveClientStage(d, { stageKey: d.key, source: 'auto', fingerprint: d.fingerprint }).changed, false, 'no write when nothing changed')
})

test('server: successful guías only, tenant-scoped state writes, tenant check on read', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync('src/lib/crm-client-stage-server.ts', 'utf8')
  assert.match(src, /NOT: \{ status: 'failed' \}/)
  assert.match(src, /updateMany\(\{\s*where: \{ clientId, tenantId \}/)
  assert.doesNotMatch(src, /clientLifecycleState\.upsert/)
  assert.match(src, /prisma\.client\.findFirst\(\{ where: \{ id: clientId, tenantId \}/)
})
