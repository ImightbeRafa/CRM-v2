import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pickLatestLinkedOrders } from '@/lib/chat-linked-orders'
import { listDtoToSoftConversation } from '@/lib/chat-inbox-v2-client'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'

test('newest linked message per conversation wins; rows without an order are ignored', () => {
  const map = pickLatestLinkedOrders([
    { conversationId: 'c1', orderId: 'o2', order: { orderId: 'PH-1042' } },
    { conversationId: 'c1', orderId: 'o1', order: { orderId: 'PH-1001' } },
    { conversationId: 'c2', orderId: null, order: null },
    { conversationId: null, orderId: 'o9', order: { orderId: 'X' } },
  ])
  assert.deepEqual(map.get('c1'), { id: 'o2', orderNumber: 'PH-1042' })
  assert.equal(map.has('c2'), false)
  assert.equal(map.size, 1)
})

test('enrichment query is tenant-scoped on the message and the order', () => {
  const src = readFileSync('src/lib/chat-linked-orders.ts', 'utf8')
  // \r?\n: the checkout may use Windows line endings.
  assert.match(src, /tenantId,\r?\n\s+conversationId: \{ in:/)
  assert.match(src, /order: \{ tenantId, deletedAt: null \}/)
  for (const route of ['src/app/api/chat/conversations/route.ts', 'src/app/api/chat/conversations/changes/route.ts']) {
    assert.match(readFileSync(route, 'utf8'), /enrichConversationDtosWithLinkedOrders\(\s*auth\.tenantId/)
  }
})

test('order-link bumps the conversation revision with a tenant-scoped update', () => {
  const src = readFileSync('src/app/api/chat/order-link/route.ts', 'utf8')
  assert.match(src, /chatConversation\s*\r?\n?\s*\.updateMany\(\{ where: \{ id: conversation\.id, tenantId \}/)
})

test('client uses the server linkedOrder when the linking message is not loaded', () => {
  const dto = {
    id: 'c1',
    peerId: '50688887777',
    socialAccountId: 's1',
    lastMessageAt: new Date().toISOString(),
    lastMessage: 'hola',
    unreadCount: 0,
    channel: { platform: 'whatsapp', displayName: 'Línea 1' },
    linkedOrder: { id: 'o2', orderNumber: 'PH-1042' },
  } as unknown as ChatConversationListItemDto
  const soft = listDtoToSoftConversation(dto, [])
  assert.equal(soft.orderId, 'o2')
  assert.equal(soft.orderNumber, 'PH-1042')
})
