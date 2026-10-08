import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeOrderTotals } from '@/lib/orders/order-totals'
import { missingOrderFields, type OrderRequirements } from '@/lib/orders/order-requirements'

const REQ: OrderRequirements = {
  customerFields: [{ key: 'cedula', label: 'Cédula' }],
  productFields: [{ key: 'talla', label: 'Talla', options: ['M/L', 'XL', '2XL'] }],
  shippingMethods: [{ id: 'm1', name: 'Correos', carrier: 'correos', basePrice: 3000 }],
}

describe('order totals = the /ventas formula', () => {
  it('line = price × qty + option deltas once; shipping only EA; IVA 13% of subtotal', () => {
    const lines = [{ productCost: 14900, cantidad: 2, optionDeltas: 500 }]
    assert.deepEqual(computeOrderTotals({ products: lines, orderType: 'EA', orderShipping: 3000 }), {
      subtotal: 30300, shipping: 3000, iva: 0, total: 33300,
    })
    assert.equal(computeOrderTotals({ products: lines, orderType: 'RA', orderShipping: 3000 }).shipping, 0)
    const withIva = computeOrderTotals({ products: [{ productCost: 1000, cantidad: 1 }], orderType: 'RA', applyOrderIVA: true })
    assert.equal(withIva.iva, 130)
    assert.equal(withIva.total, 1130)
  })

  it('/ventas ProductList uses the shared function (one formula for people and agents)', () => {
    const src = readFileSync('src/app/ventas/components/ProductList.tsx', 'utf8')
    // the ORDER total comes from the shared function (per-line IVA previews elsewhere are display only)
    assert.match(src, /const orderTotals = useMemo\(\(\) => computeOrderTotals\(\{/)
  })
})

describe('missingOrderFields — the agent never assumes order data', () => {
  it('asks envío/retiro, product, and the base customer fields first', () => {
    const keys = missingOrderFields(REQ, { orderType: null, customer: {}, lines: [] }).map((m) => m.key)
    assert.deepEqual(keys, ['orderType', 'products', 'name', 'phone', 'cedula'])
  })

  it('EA needs the full address and a shipping method (with the business options)', () => {
    const miss = missingOrderFields(REQ, {
      orderType: 'EA',
      customer: { name: 'Ana', phone: '88881111', cedula: '1' },
      lines: [{ product: 'Arnés XL', quantity: 1, unitPrice: 14900, seller: 'Agente', fields: { talla: 'XL' } }],
    })
    assert.deepEqual(miss.map((m) => m.key), ['province', 'canton', 'district', 'address', 'shippingMethod'])
    assert.deepEqual(miss.at(-1)?.options, ['Correos'])
  })

  it('RA skips the address; required product fields are asked per line with their options', () => {
    const miss = missingOrderFields(REQ, {
      orderType: 'RA',
      customer: { name: 'Ana', phone: '88881111', cedula: '1' },
      lines: [{ product: 'Arnés', quantity: 0, unitPrice: 14900, seller: 'Agente' }],
    })
    assert.deepEqual(miss.map((m) => m.key), ['line-0-quantity', 'line-0-talla'])
    assert.deepEqual(miss[1].options, ['M/L', 'XL', '2XL'])
  })

  it('a complete draft has nothing missing', () => {
    assert.deepEqual(
      missingOrderFields(REQ, {
        orderType: 'EA',
        customer: { name: 'Ana', phone: '88881111', cedula: '1', province: 'San José', canton: 'Escazú', district: 'San Rafael', address: 'Casa 4' },
        shippingMethod: 'Correos',
        lines: [{ product: 'Arnés', quantity: 1, unitPrice: 14900, seller: 'Agente', fields: { talla: 'XL' } }],
      }),
      [],
    )
  })

  it('the server loader reads only this tenant’s active, required config', () => {
    const src = readFileSync('src/lib/orders/order-requirements-server.ts', 'utf8')
    assert.match(src, /getTenantPrisma\(tenantId\)/)
    assert.match(src, /where: \{ tenantId, isActive: true, required: true \}/)
    assert.match(src, /where: \{ tenantId, active: true, required: true \}/)
    assert.match(src, /options: \{ where: \{ tenantId, active: true \}/)
  })
})
