import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeCuid, parsePedidoParams, pedidoHref, resolvePedidoRef, withPedidoParams } from '../pedido-url'

test('parsePedidoParams reads pedido / nuevo / buscar', () => {
  const p = parsePedidoParams(new URLSearchParams('pedido=ORDER-1&nuevo=1&buscar=maria'))
  assert.deepEqual(p, { pedido: 'ORDER-1', nuevo: true, buscar: 'maria' })
  assert.deepEqual(parsePedidoParams(new URLSearchParams('nuevo=0')), { pedido: null, nuevo: false, buscar: null })
  assert.deepEqual(parsePedidoParams(null), { pedido: null, nuevo: false, buscar: null })
})

test('parsePedidoParams drops blank and oversized refs', () => {
  assert.equal(parsePedidoParams(new URLSearchParams('pedido=%20%20')).pedido, null)
  assert.equal(parsePedidoParams(new URLSearchParams(`pedido=${'a'.repeat(500)}`)).pedido, null)
})

test('pedidoHref encodes the ref', () => {
  assert.equal(pedidoHref('ORDER 1/2'), '/ventas?pedido=ORDER%201%2F2')
})

test('withPedidoParams keeps other params and removes nulls', () => {
  const current = new URLSearchParams('periodo=7d&pedido=X')
  assert.equal(withPedidoParams(current, { pedido: null }), '?periodo=7d')
  assert.equal(withPedidoParams(new URLSearchParams(''), { pedido: null }), '')
  assert.equal(withPedidoParams(new URLSearchParams('a=1'), { nuevo: '1' }), '?a=1&nuevo=1')
})

test('looksLikeCuid', () => {
  assert.equal(looksLikeCuid('cm1abcdefghijklmnopqrstuv'), true)
  assert.equal(looksLikeCuid('ORDER-1712345678'), false)
})

const sale = (id: string, orderId: string) => ({ id, orderId })

test('resolvePedidoRef: loaded sale wins without any request', async () => {
  let calls = 0
  const r = await resolvePedidoRef('ORDER-1', {
    loaded: [sale('cid1', 'ORDER-1')],
    search: async () => (calls++, []),
    details: async () => (calls++, null),
  })
  assert.equal(r?.id, 'cid1')
  assert.equal(calls, 0)
})

test('resolvePedidoRef: search by public id, then details by cuid, else null', async () => {
  const viaSearch = await resolvePedidoRef('ORDER-9', {
    loaded: [],
    search: async () => [sale('c9', 'ORDER-9'), sale('c8', 'ORDER-90')],
    details: async () => null,
  })
  assert.equal(viaSearch?.id, 'c9')

  const cuid = 'cm1abcdefghijklmnopqrstuv'
  const viaDetails = await resolvePedidoRef(cuid, {
    loaded: [],
    search: async () => [],
    details: async () => sale(cuid, 'ORDER-5'),
  })
  assert.equal(viaDetails?.orderId, 'ORDER-5')

  const missing = await resolvePedidoRef('ORDER-404', {
    loaded: [],
    search: async () => [],
    details: async () => sale('x', 'y'),
  })
  assert.equal(missing, null)
})

test('resolvePedidoRef: failing search/details never throws', async () => {
  const r = await resolvePedidoRef('cm1abcdefghijklmnopqrstuv', {
    loaded: [],
    search: async () => {
      throw new Error('boom')
    },
    details: async () => {
      throw new Error('boom')
    },
  })
  assert.equal(r, null)
})
