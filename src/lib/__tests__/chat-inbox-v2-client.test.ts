import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLocalImportPayload,
  listDtoToSoftConversation,
  mergeListDtoIntoMap,
  sortedConversationDtos,
} from '../chat-inbox-v2-client'
import type { ChatConversationListItemDto } from '../chat-conversation-api'

function sampleDto(id: string, at: string): ChatConversationListItemDto {
  return {
    id,
    socialAccountId: 'sa1',
    peerId: 'peer1',
    recipientId: 'peer1',
    recipientName: 'Ana',
    status: 'nuevo',
    tags: [],
    unreadCount: 2,
    revision: '1',
    lastMessageAt: at,
    lastMessage: 'hola',
    lastMessageDirection: 'inbound',
    waWindowOpen: true,
    aiMode: null,
    assignedUserId: null,
    assignedUser: null,
    channel: { id: 'sa1', platform: 'whatsapp', displayName: 'Forge', logoKey: 'whatsapp' },
    clientId: null,
  }
}

describe('chat-inbox-v2-client reducers', () => {
  it('mergeListDtoIntoMap upserts by conversation id', () => {
    const map = mergeListDtoIntoMap(new Map(), [sampleDto('c1', '2026-01-01T00:00:00.000Z')])
    const map2 = mergeListDtoIntoMap(map, [
      { ...sampleDto('c1', '2026-01-02T00:00:00.000Z'), unreadCount: 0 },
    ])
    assert.equal(map2.get('c1')?.unreadCount, 0)
  })

  it('sortedConversationDtos orders by lastMessageAt desc', () => {
    const map = mergeListDtoIntoMap(new Map(), [
      sampleDto('c1', '2026-01-01T00:00:00.000Z'),
      sampleDto('c2', '2026-01-03T00:00:00.000Z'),
    ])
    const sorted = sortedConversationDtos(map)
    assert.equal(sorted[0]?.id, 'c2')
  })

  it('listDtoToSoftConversation maps unread and account label', () => {
    const conv = listDtoToSoftConversation(sampleDto('c1', '2026-01-01T00:00:00.000Z'), [])
    assert.equal(conv.unreadCount, 2)
    assert.equal(conv.accountLabel, 'Forge')
    assert.equal(conv.recipientId, 'peer1')
  })

  it('buildLocalImportPayload merges status and tags keys', () => {
    const items = buildLocalImportPayload(
      { 'sa1::5061': 'en_curso' },
      { 'sa1::5062': ['VIP'] },
    )
    assert.equal(items.length, 2)
  })
})
