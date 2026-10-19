/**
 * Owner fixes: chat search, open-order Pedido, multi-product replies,
 * silent handoff, and a new sale after a collected order.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConversationListWhere, type ChatConversationListQuery } from '@/lib/chat-conversation-query'
import { matchesChatSearch, planChatSearch } from '@/lib/chat-search'
import { orderMatchWhere } from '@/lib/chat-search-server'
import { isOpenOrderStatus } from '@/lib/open-order'
import { matchesInboxView, type InboxViewRow } from '@/lib/chat-inbox-views'
import { filterSoftConversations, type SoftConversation } from '@/lib/chat-soft-copilot'
import { productsNamedIn } from '@/lib/soft-ai/products-asked'
import { sweepShouldAnswer } from '@/lib/soft-ai/resume-reply'
import {
  duplicateReceiptReply,
  historyAfterSettledOrder,
  isDuplicateReceipt,
  isPaymentHandoff,
  paymentFingerprint,
  pickSettledSale,
} from '@/lib/soft-ai/repeat-order'
import { deriveSalesState, formatSalesTurnBlock, salesSystemBlock, type SalesContext } from '@/lib/soft-ai/sales-state'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

const emptyQuery = (q: string | null): ChatConversationListQuery => ({
  platform: null,
  socialAccountId: null,
  status: null,
  assigned: null,
  tag: null,
  q,
  snoozed: false,
  view: null,
})

const row = (over: Partial<InboxViewRow> = {}): InboxViewRow => ({
  aiMode: null,
  tags: [],
  lastMessageDirection: 'inbound',
  lineAiOn: true,
  closed: false,
  ...over,
})

test('search finds an order number with or without #, and a partial number', () => {
  const fields = { name: 'Jeimy', orderNumber: 'ORDER-1792273589168', peerId: 'ig-1' }
  assert.equal(matchesChatSearch('#ORDER-1792273589168', fields), true)
  assert.equal(matchesChatSearch('ORDER-1792273589168', fields), true)
  assert.equal(matchesChatSearch('1792273589168', fields), true)
  assert.equal(matchesChatSearch('179227', fields), true)
  assert.equal(matchesChatSearch('#ORDER-000', fields), false)
})

test('search finds a Costa Rica phone, a handle, an email and a name without the accent', () => {
  assert.equal(matchesChatSearch('+506 8888-7777', { peerId: '50688887777', name: 'Ana' }), true)
  assert.equal(matchesChatSearch('8888-7777', { phone: '+506 8888-7777', name: 'Ana' }), true)
  assert.equal(matchesChatSearch('@patchhouse.cr', { username: 'patchhouse.cr', name: 'Patch' }), true)
  assert.equal(matchesChatSearch('maria@shop.com', { email: 'Maria@shop.com', name: 'Ana' }), true)
  assert.equal(matchesChatSearch('maria', { name: 'María Soto' }), true)
  assert.equal(matchesChatSearch('maría', { name: 'María Soto' }), true)
})

test('a phone search does not look up order ids, and the order lookup stays on this tenant', () => {
  const phone = planChatSearch('+506 8888-7777')
  assert.ok(phone)
  assert.equal(phone.orderText, null)
  assert.equal(phone.phoneDigits, '88887777')
  const phoneWhere = orderMatchWhere('tenant-a', phone)
  assert.ok(phoneWhere)
  assert.equal(phoneWhere.tenantId, 'tenant-a')
  assert.equal(phoneWhere.deletedAt, null)
  assert.doesNotMatch(JSON.stringify(phoneWhere), /orderId/)
  assert.match(JSON.stringify(phoneWhere), /88887777/)

  const bare = planChatSearch('1792273589168')
  assert.ok(bare)
  assert.equal(bare.orderText, '1792273589168')
  assert.equal(bare.phoneDigits, null)
  const order = planChatSearch('#ORDER-1792273589168')
  assert.ok(order)
  const orderWhere = orderMatchWhere('tenant-b', order)
  assert.ok(orderWhere)
  assert.equal(orderWhere.tenantId, 'tenant-b')
  assert.match(JSON.stringify(orderWhere), /ORDER-1792273589168/)
  assert.equal(orderMatchWhere('tenant-b', order)?.tenantId === 'tenant-a', false)
})

test('the list query keeps the client filter on this tenant and can add server hit ids', () => {
  const where = buildConversationListWhere({
    tenantId: 'tenant-a',
    viewerUserId: 'user-1',
    input: emptyQuery('maria@shop.com'),
    searchConversationIds: ['conv-1'],
  })
  const json = JSON.stringify(where)
  assert.match(json, /tenant-a/)
  assert.match(json, /maria@shop.com/)
  assert.match(json, /conv-1/)
  assert.doesNotMatch(json, /"in":\[\]/)
})

test('the inbox keeps a server hit that the local name does not contain', () => {
  const chat: SoftConversation = {
    recipientId: '50688887777',
    recipientName: 'Ana',
    lastMessage: 'hola',
    socialAccountId: 'wa',
    platform: 'whatsapp',
    accountLabel: 'WA',
    status: 'en_curso',
    tags: [],
    messages: [],
    orderNumber: 'ORDER-1792273589168',
  }
  const hits = new Set(['wa|50688887777'])
  const found = filterSoftConversations([chat], {
    bucket: 'abiertos',
    channel: 'todos',
    accountId: 'all',
    search: 'maria@shop.com',
    searchHitKeys: hits,
  })
  assert.equal(found.length, 1)
  const byNumber = filterSoftConversations([chat], {
    bucket: 'abiertos',
    channel: 'todos',
    accountId: 'all',
    search: '#ORDER-1792273589168',
  })
  assert.equal(byNumber.length, 1)
})

test('Pedido is an open order; delivered and cancelled are not', () => {
  assert.equal(isOpenOrderStatus('Pendiente'), true)
  assert.equal(isOpenOrderStatus('Pagado'), true)
  assert.equal(isOpenOrderStatus('Enviado'), true)
  assert.equal(isOpenOrderStatus(''), true)
  assert.equal(isOpenOrderStatus('Entregado'), false)
  assert.equal(isOpenOrderStatus('ENTREGADA'), false)
  assert.equal(isOpenOrderStatus('Cancelado'), false)
  assert.equal(isOpenOrderStatus('devuelto'), false)
  assert.equal(matchesInboxView(row({ hasOpenOrder: true }), 'pedido'), true)
  assert.equal(matchesInboxView(row(), 'pedido'), false)
  assert.equal(matchesInboxView(row({ closed: true, hasOpenOrder: true }), 'pedido'), false)
})

const CATALOG = ['Energy Patch', 'Dopamine Patch', 'GLP-1', 'Sleep Patch']

test('Energy Dopamine Glp1 names every asked product, not one', () => {
  const named = productsNamedIn('Energy Dopamine Glp1', CATALOG)
  assert.deepEqual(named, ['Energy Patch', 'Dopamine Patch', 'GLP-1'])
  assert.equal(productsNamedIn('solo energy', CATALOG).length, 1)
})

const salesCtx: SalesContext = {
  catalog: CATALOG.map((name) => ({ name, price: 9900, stockLabel: 'disponible' })),
  shippingMethods: [],
  orderFields: ['Nombre'],
  salesScript: '',
  aiDisclosure: 'discreet',
  paymentShareable: true,
  paymentDigits: ['71133720'],
  promo: null,
}

let n = 0
const msg = (direction: 'inbound' | 'outbound', content: string, sentAt: string): SoftAiHistoryMessage => ({
  id: String((n += 1)),
  direction,
  content,
  sentAt,
})

test('the sales turn lists every product the customer named', () => {
  const state = deriveSalesState({ history: [], inboundText: 'Energy Dopamine Glp1', ctx: salesCtx })
  assert.deepEqual(state.namedProducts, ['Energy Patch', 'Dopamine Patch', 'GLP-1'])
  assert.match(state.nextStep, /Energy Patch/)
  assert.match(state.nextStep, /Dopamine Patch/)
  assert.match(state.nextStep, /GLP-1/)
  const block = formatSalesTurnBlock(salesCtx, state)
  assert.match(block, /Energy Patch/)
  assert.match(block, /Dopamine Patch/)
  assert.match(block, /GLP-1/)
  assert.match(salesSystemBlock(salesCtx), /varios productos/)
})

test('a courtesy or a payment already with the team does not get another AI reply', () => {
  assert.equal(sweepShouldAnswer({ content: 'Muchas gracias!!' }).answer, false)
  assert.equal(sweepShouldAnswer({ content: 'Muchas gracias!!' }).reason, 'courtesy')
  assert.equal(sweepShouldAnswer({ content: 'ya hice el sinpe' }).answer, false)
  assert.equal(sweepShouldAnswer({ content: '¿cuánto vale el energy?' }).answer, true)
  assert.equal(sweepShouldAnswer({ content: 'Perfecto ya le hago el sinpe' }).answer, true)
  assert.equal(sweepShouldAnswer({ content: '', messageType: 'image' }).reason, 'receipt_media')
  assert.equal(sweepShouldAnswer({ content: '¿qué es esto?', messageType: 'image' }).answer, true)
  assert.equal(sweepShouldAnswer({ content: '   ' }).reason, 'empty')
})

test('a new buy after a collected order starts a new sale and does not reuse the receipt', () => {
  const settledAt = '2026-10-18T15:00:00.000Z'
  const history = [
    msg('outbound', 'SINPE 71133720', '2026-10-18T14:00:00.000Z'),
    msg('inbound', 'ya pagué sinpe 123456789', '2026-10-18T14:30:00.000Z'),
    msg('outbound', 'Listo, pedido anotado', settledAt),
  ]
  const sticky = deriveSalesState({ history, inboundText: 'lo quiero', ctx: salesCtx })
  assert.equal(sticky.stage, 'esperando_comprobante')
  const trimmed = historyAfterSettledOrder(history, settledAt)
  assert.equal(trimmed.length, 0)
  const fresh = deriveSalesState({ history: trimmed, inboundText: 'lo quiero', ctx: salesCtx })
  assert.equal(fresh.stage, 'cierre')
  assert.equal(fresh.said.payment, false)

  const again = deriveSalesState({
    history: trimmed,
    inboundText: 'ya pagué sinpe 123456789',
    ctx: salesCtx,
    duplicateReceipt: { orderNumber: 'ORDER-55' },
  })
  assert.notEqual(again.stage, 'verificando')
  assert.equal(again.receiptCue, false)
  assert.match(again.nextStep, /ORDER-55/)
  assert.match(again.nextStep, /No lo cuentes otra vez/)
})

test('the same SINPE media or the same payment digits are a duplicate; a new receipt is not', () => {
  const index = { mediaKeys: ['media-1'], fingerprints: ['123456789'] }
  assert.equal(isDuplicateReceipt({ providerMediaId: 'media-1', content: '' }, index), true)
  assert.equal(isDuplicateReceipt({ mediaBlobPath: 'blob/a', content: 'ya pagué sinpe 123456789' }, index), true)
  assert.equal(isDuplicateReceipt({ providerMediaId: 'media-2', content: 'ya pagué sinpe 999888777' }, index), false)
  assert.equal(paymentFingerprint('mi teléfono es 88887777'), null)
  assert.equal(
    pickSettledSale([
      { sentAt: '2026-10-01T00:00:00.000Z', orderNumber: 'ORDER-1', collected: true },
      { sentAt: '2026-10-18T00:00:00.000Z', orderNumber: 'ORDER-2', collected: false },
      { sentAt: '2026-10-10T00:00:00.000Z', orderNumber: 'ORDER-3', collected: true },
    ])?.orderNumber,
    'ORDER-3',
  )
  assert.equal(isPaymentHandoff({ intent: 'payment_proof', handoff: { reason: 'payment' } }), true)
  assert.equal(isPaymentHandoff({ intent: 'other', handoff: { reason: 'human_request' } }), false)
  assert.match(duplicateReceiptReply('ORDER-55'), /ORDER-55/)
  assert.match(duplicateReceiptReply('ORDER-55'), /No lo cuento otra vez/)
})
