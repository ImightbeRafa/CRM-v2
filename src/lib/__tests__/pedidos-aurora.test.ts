import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  channelChip,
  countByTab,
  matchesTab,
  paginate,
  paymentChip,
  searchPedidos,
  shipChip,
  summarizePedidos,
  type PedidoRow,
} from '../pedidos-aurora'

function order(over: Partial<PedidoRow> = {}): PedidoRow {
  return { orderId: 'PH-1', orderType: 'EA', status: 'Pendiente', total: 1000, ...over }
}

describe('pedidos-aurora payment chip', () => {
  it('flags SINPE pending from comments', () => {
    const chip = paymentChip(order({ comments: 'Pago: SINPE Móvil' }))
    assert.equal(chip.label, 'Pendiente SINPE')
    assert.equal(chip.collected, false)
  })
  it('plain pending stays generic without SINPE evidence', () => {
    assert.equal(paymentChip(order()).label, 'Pendiente de pago')
  })
  it('in-progress orders count as paid', () => {
    const chip = paymentChip(order({ status: 'En Proceso' }))
    assert.equal(chip.tone, 'paid')
  })
  it('contra entrega until confirmed', () => {
    assert.equal(paymentChip(order({ contraEntrega: true })).tone, 'cod')
    assert.equal(paymentChip(order({ contraEntrega: true, cePaymentConfirmed: true })).tone, 'paid')
  })
})

describe('pedidos-aurora ship chip and tabs', () => {
  it('maps status to Envío stage', () => {
    assert.equal(shipChip(order()).label, 'Preparando')
    assert.equal(shipChip(order({ status: 'Enviado', courier: 'Correos de Costa Rica' })).label, 'En tránsito · Correos')
    assert.equal(shipChip(order({ status: 'Entregado' })).tone, 'done')
    assert.equal(shipChip(order({ orderType: 'RA' })).tone, 'pickup')
  })
  it('tab membership', () => {
    const rows = [
      order({ orderId: 'a' }),
      order({ orderId: 'b', status: 'Enviado' }),
      order({ orderId: 'c', status: 'Entregado' }),
      order({ orderId: 'd', orderType: 'RA', status: 'En Proceso' }),
    ]
    assert.equal(matchesTab(rows[1], 'en_transito'), true)
    assert.equal(matchesTab(rows[3], 'por_enviar'), false)
    const counts = countByTab(rows)
    assert.deepEqual(counts, { todos: 4, por_cobrar: 1, por_enviar: 1, en_transito: 1, entregados: 1 })
  })
})

describe('pedidos-aurora KPIs, channel, search, paging', () => {
  it('summarizes sales, pending SINPE and overdue transit', () => {
    const now = Date.parse('2026-09-26T12:00:00Z')
    const kpis = summarizePedidos(
      [
        { ...order({ orderId: '1', status: 'En Proceso', total: 5000 }), timestamp: '2026-09-26T10:00:00Z' },
        { ...order({ orderId: '2', total: 2000, comments: 'Pago: sinpe' }), timestamp: '2026-09-26T10:00:00Z' },
        { ...order({ orderId: '3', status: 'Enviado', total: 3000 }), timestamp: '2026-09-20T10:00:00Z' },
        { ...order({ orderId: '4', status: 'Cancelado', total: 9999 }), timestamp: '2026-09-26T10:00:00Z' },
      ],
      now,
    )
    assert.equal(kpis.orderCount, 3)
    assert.equal(kpis.salesTotal, 8000)
    assert.equal(kpis.pendingAmount, 2000)
    assert.equal(kpis.pendingSinpeCount, 1)
    assert.equal(kpis.inTransitCount, 1)
    assert.equal(kpis.inTransitOverdue, 1)
  })
  it('channel chip falls back to funnel and is null when unknown', () => {
    assert.equal(channelChip({ salesChannel: 'whatsapp' })?.family, 'whatsapp')
    assert.equal(channelChip({ funnel: 'IG' })?.label, 'Instagram')
    assert.equal(channelChip({ salesChannel: 'Website' })?.label, 'Web')
    assert.equal(channelChip({}), null)
  })
  it('search ignores accents/case and matches phone', () => {
    const rows = [order({ customerName: 'Sofía Mora', phone: '+50660027713' }), order({ orderId: 'X', customerName: 'Otro' })]
    assert.equal(searchPedidos(rows, 'sofia').length, 1)
    assert.equal(searchPedidos(rows, '6002').length, 1)
    assert.equal(searchPedidos(rows, '').length, 2)
  })
  it('paginate clamps page', () => {
    const p = paginate([1, 2, 3, 4, 5], 9, 2)
    assert.deepEqual(p.items, [5])
    assert.equal(p.page, 3)
  })
})

describe('/ventas Aurora wiring', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/app/ventas/components/VentasComponent.tsx'), 'utf8')
  it('renders inside AuroraShell and keeps the create flow', () => {
    assert.match(src, /AuroraShell/)
    assert.match(src, /EnhancedSalesForm/)
    assert.doesNotMatch(src, /Ventas Soft|Soft/)
  })
})
