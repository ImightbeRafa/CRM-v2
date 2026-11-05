import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  COD_CLOSED_STATUSES,
  PENDING_PAYMENT_LOOKBACK_DAYS,
  daysWaiting,
  pendingPaymentKind,
  pendingPaymentWhere,
} from '../orders/pending-payments'

describe('pending payments (Pedidos › Pagos por confirmar)', () => {
  it('contra entrega not confirmed needs a person', () => {
    assert.equal(pendingPaymentKind({ status: 'Enviado', contraEntrega: true, cePaymentConfirmed: false }), 'contra_entrega')
    assert.equal(pendingPaymentKind({ status: 'Pendiente', contraEntrega: true, cePaymentConfirmed: false }), 'contra_entrega')
  })

  it('confirmed contra entrega is done; a "paid" note alone does not hide it (Inicio counts the columns)', () => {
    assert.equal(pendingPaymentKind({ status: 'Enviado', contraEntrega: true, cePaymentConfirmed: true }), null)
    assert.equal(
      pendingPaymentKind({ status: 'Enviado', contraEntrega: true, cePaymentConfirmed: false, customFields: { paymentStatus: 'paid' } }),
      'contra_entrega',
    )
  })

  it('matches the Inicio card: closed and returned contra entrega orders are not listed', () => {
    for (const status of COD_CLOSED_STATUSES) {
      assert.equal(pendingPaymentKind({ status, contraEntrega: true, cePaymentConfirmed: false }), null, status)
    }
    assert.ok(COD_CLOSED_STATUSES.includes('Devuelto'))
    const stats = readFileSync(resolve(process.cwd(), 'src/app/api/dashboard/stats/route.ts'), 'utf8')
    assert.match(stats, /\.\.\.codPendingWhere\(\)/)
  })

  it('SINPE waiting for the receipt needs a person', () => {
    assert.equal(
      pendingPaymentKind({ status: 'Pendiente', contraEntrega: false, customFields: { paymentMethod: 'SINPE', paymentStatus: 'pending' } }),
      'sinpe',
    )
    assert.equal(pendingPaymentKind({ status: 'Pendiente', contraEntrega: false, comments: 'Pago por SINPE Móvil' }), 'sinpe')
  })

  it('paid SINPE, cancelled orders and non-SINPE pending are not listed (confirm-payment would refuse them)', () => {
    assert.equal(
      pendingPaymentKind({ status: 'Pendiente', contraEntrega: false, customFields: { paymentMethod: 'SINPE', paymentStatus: 'paid' } }),
      null,
    )
    assert.equal(pendingPaymentKind({ status: 'Cancelado', contraEntrega: false, comments: 'SINPE' }), null)
    assert.equal(pendingPaymentKind({ status: 'Cancelado', contraEntrega: true, cePaymentConfirmed: false }), null)
    assert.equal(pendingPaymentKind({ status: 'Pendiente', contraEntrega: false, customFields: { paymentMethod: 'Tilopay' } }), null)
  })

  it('the SQL narrows SINPE to the lookback window and keeps contra entrega of any date', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    const where = pendingPaymentWhere(now)
    const cod = where.OR[0]
    const sinpe = where.OR[1] as { contraEntrega: boolean; timestamp?: { gte: Date }; AND: unknown }
    assert.deepEqual(cod, { contraEntrega: true, cePaymentConfirmed: false, status: { notIn: COD_CLOSED_STATUSES } })
    assert.equal((cod as Record<string, unknown>).timestamp, undefined)
    assert.equal(sinpe.contraEntrega, false)
    // Only SINPE that can still be waiting reaches the cap (paid SINPE would crowd out old contra entrega).
    assert.match(JSON.stringify(sinpe.AND), /"status":"Pendiente"/)
    assert.match(JSON.stringify(sinpe.AND), /"paymentStatus"\],"equals":"pending"/)
    assert.equal(sinpe.timestamp?.gte.getTime(), now.getTime() - PENDING_PAYMENT_LOOKBACK_DAYS * 86_400_000)
  })

  it('days waiting', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    assert.equal(daysWaiting('2026-11-04T08:00:00Z', now), 0)
    assert.equal(daysWaiting('2026-10-26T12:00:00Z', now), 9)
    assert.equal(daysWaiting(null, now), null)
    assert.equal(daysWaiting('not a date', now), null)
  })

  it('the orders API filters with the same rule and ignores the date range', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/orders/route.ts'), 'utf8')
    assert.match(route, /searchParams\.get\('pago'\) === 'por_confirmar'/)
    assert.match(route, /pendingPayments \? pendingPaymentWhere\(\) : \{\}/)
    assert.match(route, /!pendingPayments && \(dateFrom \|\| dateTo\)/)
    assert.match(route, /pendingPaymentKind\(o\) !== null/)
  })

  it('Pedidos shows the section and Inicio "Revisar" opens it', () => {
    const board = readFileSync(resolve(process.cwd(), 'src/app/ventas/components/PedidosBoard.tsx'), 'utf8')
    assert.match(board, /\/api\/orders\?pago=por_confirmar/)
    assert.match(board, /<PagosPorConfirmar/)
    const home = readFileSync(resolve(process.cwd(), 'src/app/dashboard/components/AuroraHome.tsx'), 'utf8')
    assert.match(home, /href: '\/ventas\?vista=pagos&tipo=ce'/)
    const ventas = readFileSync(resolve(process.cwd(), 'src/app/ventas/components/VentasComponent.tsx'), 'utf8')
    assert.match(ventas, /get\('vista'\) === 'pagos'/)
  })
})
