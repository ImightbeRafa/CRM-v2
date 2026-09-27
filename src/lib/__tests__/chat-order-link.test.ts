import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAlreadyLinked, parseOrderLinkBody, pickLinkTarget } from '../chat-order-link'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const msg = (id: string, direction: string, orderId: string | null = null) => ({ id, direction, orderId })

test('pickLinkTarget prefers the newest unlinked inbound message', () => {
  const target = pickLinkTarget([msg('m3', 'outbound'), msg('m2', 'inbound'), msg('m1', 'inbound')])
  assert.equal(target?.id, 'm2')
})

test('pickLinkTarget skips messages that already carry an order', () => {
  const target = pickLinkTarget([msg('m3', 'inbound', 'ord_a'), msg('m2', 'inbound'), msg('m1', 'inbound')])
  assert.equal(target?.id, 'm2')
})

test('pickLinkTarget falls back to an outbound message, then to null', () => {
  assert.equal(pickLinkTarget([msg('m2', 'outbound'), msg('m1', 'inbound', 'ord_a')])?.id, 'm2')
  assert.equal(pickLinkTarget([msg('m1', 'inbound', 'ord_a'), msg('m0', 'outbound', 'ord_b')]), null)
  assert.equal(pickLinkTarget([]), null)
})

test('isAlreadyLinked checks the order id on any message', () => {
  const thread = [msg('m2', 'inbound', 'ord_a'), msg('m1', 'inbound')]
  assert.equal(isAlreadyLinked(thread, 'ord_a'), true)
  assert.equal(isAlreadyLinked(thread, 'ord_b'), false)
})

test('parseOrderLinkBody accepts 1–200 char strings only', () => {
  assert.deepEqual(parseOrderLinkBody({ socialAccountId: 'a', peerId: '5068888', order: 'PH-1' }), {
    socialAccountId: 'a',
    peerId: '5068888',
    order: 'PH-1',
  })
  assert.equal(parseOrderLinkBody({ socialAccountId: 'a', peerId: 'p' }), null)
  assert.equal(parseOrderLinkBody({ socialAccountId: '', peerId: 'p', order: 'o' }), null)
  assert.equal(parseOrderLinkBody({ socialAccountId: 'a', peerId: 'x'.repeat(201), order: 'o' }), null)
  assert.equal(parseOrderLinkBody({ socialAccountId: 'a', peerId: 5, order: 'o' }), null)
  assert.equal(parseOrderLinkBody(null), null)
})

test('order-link route: update_sales, tenant-scoped everywhere, conditional write, no bot/env', () => {
  const src = read('src/app/api/chat/order-link/route.ts')
  assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  for (const call of ['socialAccount.findFirst', 'order.findFirst', 'chatConversation.findFirst', 'chatMessage.findMany', 'chatMessage.updateMany']) {
    const i = src.indexOf(call)
    assert.ok(i >= 0, `${call} present`)
    assert.match(src.slice(i, i + 260), /tenantId/, `${call} filters by tenantId`)
  }
  const write = src.slice(src.indexOf('chatMessage.updateMany'))
  assert.match(write.slice(0, 200), /orderId: null/)
  assert.doesNotMatch(src, /@\/lib\/bot|@\/app\/api\/bot/)
  assert.doesNotMatch(src, /process\.env/)
})

test('EnhancedSalesForm never sends chat identifiers to POST /api/orders (they would land in customFields)', () => {
  const src = read('src/app/ventas/components/EnhancedSalesForm.tsx')
  assert.doesNotMatch(src, /conversationId|socialAccountId|peerId/)
})
