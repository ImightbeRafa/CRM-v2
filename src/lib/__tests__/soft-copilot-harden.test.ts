import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chatMessagesWhereForPeer,
  mergeChatMessagesById,
  nextThreadPager,
} from '../chat-message-query'
import { canAccessRoute, hasPermission } from '../rbac'

test('chatMessagesWhereForPeer without recipientId scopes to socialAccountId only', () => {
  assert.deepEqual(chatMessagesWhereForPeer({ socialAccountId: 'sa-1' }), {
    socialAccountId: 'sa-1',
  })
})

test('chatMessagesWhereForPeer with recipientId filters inbound from / outbound to', () => {
  const where = chatMessagesWhereForPeer({
    socialAccountId: 'sa-1',
    recipientId: '50688887777',
  }) as any
  assert.equal(where.socialAccountId, 'sa-1')
  assert.ok(Array.isArray(where.OR))
  assert.equal(where.OR.length, 3)
  assert.equal(where.OR[0].AND[1].metadata.equals, '50688887777')
})

test('mergeChatMessagesById dedupes and sorts by sentAt ascending', () => {
  const merged = mergeChatMessagesById(
    [
      { id: 'a', sentAt: '2026-09-10T10:00:00.000Z' },
      { id: 'b', sentAt: '2026-09-10T11:00:00.000Z' },
    ],
    [
      { id: 'b', sentAt: '2026-09-10T11:00:00.000Z' },
      { id: 'c', sentAt: '2026-09-10T09:00:00.000Z' },
    ],
  )
  assert.deepEqual(
    merged.map((m) => m.id),
    ['c', 'a', 'b'],
  )
})

test('nextThreadPager clears cursor when hasMore is false', () => {
  assert.deepEqual(nextThreadPager({ nextCursor: 'msg-9', hasMore: true }), {
    hasMore: true,
    nextCursor: 'msg-9',
  })
  assert.deepEqual(nextThreadPager({ nextCursor: 'msg-9', hasMore: false }), {
    hasMore: false,
    nextCursor: undefined,
  })
})

test('RBAC: /chats requires update_sales (same class as send), not view_sales alone', () => {
  assert.equal(canAccessRoute('SALES', '/chats'), true)
  assert.equal(canAccessRoute('MANAGER', '/chats'), true)
  assert.equal(canAccessRoute('ADMIN', '/chats'), true)
  assert.equal(canAccessRoute('OWNER', '/chats'), true)
  assert.equal(canAccessRoute('VIEWER', '/chats'), false)
  assert.equal(canAccessRoute('PRODUCTION', '/chats'), false)
  assert.equal(hasPermission('VIEWER', 'view_sales'), true)
  assert.equal(hasPermission('VIEWER', 'update_sales'), false)
})
