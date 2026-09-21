import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  advanceRevisionCursor,
  buildChangesPollQuery,
  buildChatTemplateSendBody,
  buildLocalImportPayload,
  CHAT_INBOX_V2_LIST_PAGE_LIMIT,
  CHAT_INBOX_V2_POLL_MS,
  CHAT_INBOX_V2_THREAD_RENDER_WINDOW,
  CHAT_INBOX_V2_THREAD_STORE_CAP,
  decideInboxV2PollTick,
  listDtoToSoftConversation,
  mergeListDtoIntoMap,
  mergeThreadMessageWindow,
  selectThreadRenderWindow,
  sortedConversationDtos,
  walkConversationListPages,
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
    channel: { id: 'sa1', platform: 'whatsapp', displayName: 'Forge', logoKey: 'whatsapp', address: '+506 6104 3737' },
    clientId: null,
  }
}

function msg(id: string, sentAt: string) {
  return { id, sentAt }
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

  it('walkConversationListPages follows nextCursor, dedupes, and keeps maxRevision only when complete', async () => {
    const firstPage = Array.from({ length: CHAT_INBOX_V2_LIST_PAGE_LIMIT }, (_, i) =>
      sampleDto(`c-${i}`, `2026-01-02T00:00:${String(i).padStart(2, '0')}.000Z`),
    )
    const secondPage = [
      sampleDto('c-50', '2025-12-01T00:00:00.000Z'),
      { ...firstPage[0]!, unreadCount: 0, lastMessageAt: '2026-01-03T00:00:00.000Z' },
    ]
    const pages = [
      {
        conversations: firstPage,
        nextCursor: 'cursor-2',
        maxRevision: '10',
      },
      {
        conversations: secondPage,
        nextCursor: null,
        maxRevision: '11',
      },
    ]
    let calls = 0
    const walked = await walkConversationListPages({
      fetchPage: async (cursor) => {
        const page = pages[calls]
        if (calls === 0) assert.equal(cursor, null)
        if (calls === 1) assert.equal(cursor, 'cursor-2')
        calls += 1
        return page!
      },
    })
    assert.equal(calls, 2)
    assert.equal(walked.complete, true)
    assert.equal(walked.stopReason, 'complete')
    assert.equal(walked.maxRevision, '11')
    assert.equal(walked.items.length, 51)
    assert.equal(walked.items.find((row) => row.id === 'c-0')?.unreadCount, 0)
  })

  it('walkConversationListPages stops on repeated cursors and does not keep maxRevision', async () => {
    const walked = await walkConversationListPages({
      fetchPage: async () => ({
        conversations: [sampleDto('c1', '2026-01-01T00:00:00.000Z')],
        nextCursor: 'same',
        maxRevision: '99',
      }),
    })
    assert.equal(walked.complete, false)
    assert.equal(walked.stopReason, 'repeated_cursor')
    assert.equal(walked.maxRevision, null)
    assert.equal(walked.items[0]?.id, 'c1')
  })

  it('walkConversationListPages leaves the caller to keep the old map on a mid-walk throw', async () => {
    const previous = mergeListDtoIntoMap(new Map(), [sampleDto('keep', '2026-01-01T00:00:00.000Z')])
    let walked = previous
    try {
      await walkConversationListPages({
        fetchPage: async (cursor) => {
          if (!cursor) {
            return {
              conversations: [sampleDto('c1', '2026-01-02T00:00:00.000Z')],
              nextCursor: 'page-2',
              maxRevision: '5',
            }
          }
          throw new Error('list_failed')
        },
      })
      assert.fail('expected mid-walk failure')
    } catch (error) {
      assert.equal((error as Error).message, 'list_failed')
      walked = previous
    }
    assert.equal(walked.get('keep')?.id, 'keep')
    assert.equal(walked.size, 1)
  })

  it('buildChatTemplateSendBody matches the legacy APPROVED template POST', () => {
    assert.deepEqual(
      buildChatTemplateSendBody({
        socialAccountId: 'sa1',
        recipient: '50688880001',
        template: { name: 'hello_world', language: 'es' },
      }),
      {
        socialAccountId: 'sa1',
        recipient: '50688880001',
        type: 'template',
        templateName: 'hello_world',
        templateLanguage: 'es',
        content: '[Plantilla] hello_world',
      },
    )
  })

  it('advanceRevisionCursor never jumps to tenant head; drains when hasMoreChanges', () => {
    const stepped = advanceRevisionCursor({
      current: BigInt(10),
      nextRevision: '15',
      maxRevision: '999',
      hasMoreChanges: true,
    })
    assert.equal(stepped.next, BigInt(15))
    assert.equal(stepped.continueDrain, true)

    const idle = advanceRevisionCursor({
      current: BigInt(15),
      nextRevision: '15',
      hasMoreChanges: false,
    })
    assert.equal(idle.next, BigInt(15))
    assert.equal(idle.continueDrain, false)
  })

  it('decideInboxV2PollTick pauses when hidden or in-flight; reconciles on interval', () => {
    assert.deepEqual(
      decideInboxV2PollTick({
        documentHidden: true,
        inFlight: false,
        nowMs: 10_000,
        lastFullReconcileMs: 0,
      }),
      { action: 'skip', reason: 'hidden' },
    )
    assert.deepEqual(
      decideInboxV2PollTick({
        documentHidden: false,
        inFlight: true,
        nowMs: 10_000,
        lastFullReconcileMs: 0,
      }),
      { action: 'skip', reason: 'in_flight' },
    )
    assert.deepEqual(
      decideInboxV2PollTick({
        documentHidden: false,
        inFlight: false,
        nowMs: 200_000,
        lastFullReconcileMs: 0,
      }),
      { action: 'reconcile' },
    )
    assert.deepEqual(
      decideInboxV2PollTick({
        documentHidden: false,
        inFlight: false,
        nowMs: 10_000,
        lastFullReconcileMs: 9_000,
      }),
      { action: 'changes' },
    )
  })

  it('selectThreadRenderWindow keeps last N; mergeThreadMessageWindow caps store', () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      msg(
        `m${i}`,
        `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
      ),
    )
    const windowed = selectThreadRenderWindow(many, CHAT_INBOX_V2_THREAD_RENDER_WINDOW)
    assert.equal(windowed.length, CHAT_INBOX_V2_THREAD_RENDER_WINDOW)
    assert.equal(windowed[0]?.id, `m${250 - CHAT_INBOX_V2_THREAD_RENDER_WINDOW}`)
    assert.ok(windowed.length <= 500)

    const older = mergeThreadMessageWindow({
      existing: many.slice(100),
      incoming: many.slice(0, 100),
      mode: 'older',
      storeCap: CHAT_INBOX_V2_THREAD_STORE_CAP,
    })
    assert.ok(older.length <= CHAT_INBOX_V2_THREAD_STORE_CAP)
  })

  it('buildChangesPollQuery piggybacks thread tail params', () => {
    const qs = buildChangesPollQuery({
      afterRevision: '42',
      threadId: 'conv1',
      threadAfter: '2026-01-01T00:00:00.000Z,m9',
    })
    assert.match(qs, /afterRevision=42/)
    assert.match(qs, /threadId=conv1/)
    assert.match(qs, /threadAfter=/)
  })

  it('v2 inbox uses single poll scheduler at 5s and posts templates', () => {
    assert.equal(CHAT_INBOX_V2_POLL_MS, 5000)
    const src = readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
    assert.match(src, /decideInboxV2PollTick/)
    assert.match(src, /advanceRevisionCursor/)
    assert.match(src, /buildChangesPollQuery/)
    assert.match(src, /pollInFlightRef/)
    assert.match(src, /document\.hidden/)
    assert.match(src, /buildChatTemplateSendBody/)
    assert.match(src, /\/api\/chat\/templates/)
    assert.doesNotMatch(src, /walkConversationListPages/)
    assert.doesNotMatch(src, /onSendTemplate: \(\) => \{\}/)
  })
})
