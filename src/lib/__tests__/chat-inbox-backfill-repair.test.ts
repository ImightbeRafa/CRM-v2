import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  computeConversationAggregate,
  planBackfillBatch,
  type ChatInboxBackfillMessage,
} from '../chat-conversation-foundation'
import {
  countActiveLinkedMessages,
  findAggregateCountMismatches,
  planAggregateRepairIds,
  repairConversationAggregates,
  type BackfillRepairStore,
  type ConversationCountSnapshot,
  type LinkedMessageCountRow,
} from '../chat-inbox-backfill-repair'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function msg(
  partial: Partial<ChatInboxBackfillMessage> &
    Pick<ChatInboxBackfillMessage, 'id' | 'direction' | 'content' | 'sentAt'>,
): ChatInboxBackfillMessage {
  return {
    tenantId: 't1',
    socialAccountId: 'sa1',
    metadata: { from: '507' },
    ...partial,
  }
}

interface MemoryConversation extends ConversationCountSnapshot {
  lastMessageId: string | null
  lastMessageAt: Date | null
  lastMessagePreview: string | null
  lastMessageDirection: string | null
  lastInboundAt: Date | null
  lastOutboundAt: Date | null
}

function createMemoryStore(seed: {
  conversations: MemoryConversation[]
  messages: ChatInboxBackfillMessage[]
  recomputeBudget?: number
}): {
  store: BackfillRepairStore
  conversations: Map<string, MemoryConversation>
  messages: ChatInboxBackfillMessage[]
  recomputeCalls: string[][]
} {
  const conversations = new Map(seed.conversations.map((row) => [row.id, { ...row }]))
  const messages = seed.messages.map((row) => ({ ...row }))
  const recomputeCalls: string[][] = []
  let budget = seed.recomputeBudget ?? Number.POSITIVE_INFINITY

  const store: BackfillRepairStore = {
    async listConversations(tenantId) {
      return [...conversations.values()]
        .filter((row) => !tenantId || row.tenantId === tenantId)
        .map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          messageCount: row.messageCount,
          inboundCount: row.inboundCount,
        }))
    },
    async listActualCounts(tenantId) {
      const rows: LinkedMessageCountRow[] = messages
        .filter((row) => row.conversationId && (!tenantId || row.tenantId === tenantId))
        .map((row) => ({
          conversationId: row.conversationId as string,
          tenantId: row.tenantId,
          direction: String(row.direction),
          duplicateOfMessageId: row.duplicateOfMessageId ?? null,
        }))
      return countActiveLinkedMessages(rows)
    },
    async recomputeAggregates(conversationIds) {
      recomputeCalls.push([...conversationIds])
      const updated: string[] = []
      for (const id of conversationIds) {
        if (budget <= 0) break
        const conversation = conversations.get(id)
        if (!conversation) continue
        const aggregate = computeConversationAggregate(
          messages.filter((row) => row.conversationId === id),
        )
        conversation.messageCount = aggregate.messageCount
        conversation.inboundCount = aggregate.inboundCount
        if (aggregate.lastMessageAt) {
          conversation.lastMessageId = aggregate.lastMessageId
          conversation.lastMessageAt = aggregate.lastMessageAt
          conversation.lastMessagePreview = aggregate.lastMessagePreview
          conversation.lastMessageDirection = aggregate.lastMessageDirection
          conversation.lastInboundAt = aggregate.lastInboundAt
          conversation.lastOutboundAt = aggregate.lastOutboundAt
        }
        budget -= 1
        updated.push(id)
      }
      return updated
    },
  }

  return { store, conversations, messages, recomputeCalls }
}

function seedZeroConversation(
  id: string,
  first: ChatInboxBackfillMessage,
  tenantId = 't1',
): MemoryConversation {
  return {
    id,
    tenantId,
    messageCount: 0,
    inboundCount: 0,
    lastMessageId: first.id,
    lastMessageAt: new Date(first.sentAt),
    lastMessagePreview: first.content,
    lastMessageDirection: String(first.direction),
    lastInboundAt: first.direction === 'inbound' ? new Date(first.sentAt) : null,
    lastOutboundAt: first.direction === 'inbound' ? null : new Date(first.sentAt),
  }
}

describe('chat-inbox-backfill resume aggregate repair', () => {
  it('script no longer gates apply recompute on touched.size', () => {
    const src = readFileSync(join(root, 'scripts/chat-inbox-backfill.ts'), 'utf8')
    assert.doesNotMatch(src, /if \(options\.apply && touched\.size > 0\)/)
    assert.match(src, /repairConversationAggregates/)
    assert.match(src, /already-linked rows still get aggregate repair/)
  })

  it('touched-only planning skips already-linked seed-zero conversations', () => {
    const inbound = msg({
      id: 'm1',
      direction: 'inbound',
      content: 'hola',
      sentAt: '2026-09-20T10:00:00.000Z',
      conversationId: 'conv-seed',
    })
    const outbound = msg({
      id: 'm2',
      direction: 'outbound',
      content: 'ok',
      sentAt: '2026-09-20T10:01:00.000Z',
      conversationId: 'conv-seed',
    })
    const resume = planBackfillBatch([inbound, outbound], new Map(), () => 'should-not-create')
    assert.equal(resume.linked.length, 0)
    assert.equal(resume.touchedConversationIds.size, 0)

    const mismatches = findAggregateCountMismatches(
      [{ id: 'conv-seed', tenantId: 't1', messageCount: 0, inboundCount: 0 }],
      countActiveLinkedMessages([
        {
          conversationId: 'conv-seed',
          tenantId: 't1',
          direction: 'inbound',
          duplicateOfMessageId: null,
        },
        {
          conversationId: 'conv-seed',
          tenantId: 't1',
          direction: 'outbound',
          duplicateOfMessageId: null,
        },
      ]),
    )
    assert.equal(mismatches.length, 1)
    assert.deepEqual(planAggregateRepairIds(resume.touchedConversationIds, []), [])
    assert.deepEqual(planAggregateRepairIds(resume.touchedConversationIds, mismatches), [
      'conv-seed',
    ])
  })

  it('rerun with no unlinked rows repairs seed inboundCount/messageCount 0', async () => {
    const inbound = msg({
      id: 'm1',
      direction: 'inbound',
      content: 'hola',
      sentAt: '2026-09-20T10:00:00.000Z',
      conversationId: 'conv-seed',
    })
    const outbound = msg({
      id: 'm2',
      direction: 'outbound',
      content: 'ok',
      sentAt: '2026-09-20T10:01:00.000Z',
      conversationId: 'conv-seed',
    })
    const { store, conversations, recomputeCalls } = createMemoryStore({
      conversations: [seedZeroConversation('conv-seed', inbound)],
      messages: [inbound, outbound],
    })

    const unlinked = [inbound, outbound].filter((row) => !row.conversationId)
    assert.equal(unlinked.length, 0)

    const report = await repairConversationAggregates(store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(report.touched, 0)
    assert.equal(report.mismatchCandidates, 1)
    assert.deepEqual(report.repairIds, ['conv-seed'])
    assert.deepEqual(report.repaired, ['conv-seed'])
    assert.deepEqual(recomputeCalls, [['conv-seed']])

    const repaired = conversations.get('conv-seed')
    assert.ok(repaired)
    assert.equal(repaired.messageCount, 2)
    assert.equal(repaired.inboundCount, 1)
    assert.equal(repaired.lastMessageId, 'm2')
    assert.equal(repaired.lastMessagePreview, 'ok')
  })

  it('repairs an existing conversation whose stored counts are nonzero but stale', async () => {
    const rows = [
      msg({
        id: 'm1',
        direction: 'inbound',
        content: 'one',
        sentAt: '2026-09-20T10:00:00.000Z',
        conversationId: 'conv-stale',
      }),
      msg({
        id: 'm2',
        direction: 'inbound',
        content: 'two',
        sentAt: '2026-09-20T10:02:00.000Z',
        conversationId: 'conv-stale',
      }),
      msg({
        id: 'm3',
        direction: 'outbound',
        content: 'three',
        sentAt: '2026-09-20T10:03:00.000Z',
        conversationId: 'conv-stale',
      }),
    ]
    const { store, conversations } = createMemoryStore({
      conversations: [
        {
          ...seedZeroConversation('conv-stale', rows[0]),
          messageCount: 1,
          inboundCount: 1,
        },
      ],
      messages: rows,
    })

    const report = await repairConversationAggregates(store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(report.mismatchCandidates, 1)
    const repaired = conversations.get('conv-stale')
    assert.ok(repaired)
    assert.equal(repaired.messageCount, 3)
    assert.equal(repaired.inboundCount, 2)
    assert.equal(repaired.lastMessageId, 'm3')
  })

  it('after duplicate marking, rerun excludes dups from counts and last message', async () => {
    const canonical = msg({
      id: 'm1',
      direction: 'inbound',
      content: 'first',
      sentAt: '2026-09-20T10:00:00.000Z',
      conversationId: 'conv-dup',
    })
    const duplicate = msg({
      id: 'm2',
      direction: 'inbound',
      content: 'dup',
      sentAt: '2026-09-20T10:02:00.000Z',
      conversationId: 'conv-dup',
      duplicateOfMessageId: 'm1',
    })
    const { store, conversations } = createMemoryStore({
      conversations: [
        {
          ...seedZeroConversation('conv-dup', canonical),
          messageCount: 2,
          inboundCount: 2,
          lastMessageId: 'm2',
          lastMessageAt: new Date('2026-09-20T10:02:00.000Z'),
          lastMessagePreview: 'dup',
        },
      ],
      messages: [canonical, duplicate],
    })

    const report = await repairConversationAggregates(store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(report.mismatchCandidates, 1)
    const repaired = conversations.get('conv-dup')
    assert.ok(repaired)
    assert.equal(repaired.messageCount, 1)
    assert.equal(repaired.inboundCount, 1)
    assert.equal(repaired.lastMessageId, 'm1')
    assert.equal(repaired.lastMessagePreview, 'first')
  })

  it('interrupted repair of two conversations is completed on the next rerun', async () => {
    const a1 = msg({
      id: 'a1',
      direction: 'inbound',
      content: 'a',
      sentAt: '2026-09-20T10:00:00.000Z',
      conversationId: 'conv-a',
    })
    const b1 = msg({
      id: 'b1',
      direction: 'inbound',
      content: 'b',
      sentAt: '2026-09-20T10:00:01.000Z',
      conversationId: 'conv-b',
    })
    const first = createMemoryStore({
      conversations: [seedZeroConversation('conv-a', a1), seedZeroConversation('conv-b', b1)],
      messages: [a1, b1],
      recomputeBudget: 1,
    })

    const partial = await repairConversationAggregates(first.store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(partial.mismatchCandidates, 2)
    assert.equal(partial.repaired.length, 1)
    const repairedId = partial.repaired[0]
    const leftoverId = repairedId === 'conv-a' ? 'conv-b' : 'conv-a'
    assert.equal(first.conversations.get(repairedId)?.messageCount, 1)
    assert.equal(first.conversations.get(leftoverId)?.messageCount, 0)

    const second = createMemoryStore({
      conversations: [...first.conversations.values()],
      messages: [a1, b1],
    })
    const resume = await repairConversationAggregates(second.store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(resume.mismatchCandidates, 1)
    assert.deepEqual(resume.repairIds, [leftoverId])
    assert.equal(second.conversations.get('conv-a')?.messageCount, 1)
    assert.equal(second.conversations.get('conv-b')?.messageCount, 1)
  })

  it('a clean rerun is a no-op after aggregates already match', async () => {
    const inbound = msg({
      id: 'm1',
      direction: 'inbound',
      content: 'hola',
      sentAt: '2026-09-20T10:00:00.000Z',
      conversationId: 'conv-ok',
    })
    const { store, recomputeCalls } = createMemoryStore({
      conversations: [
        {
          ...seedZeroConversation('conv-ok', inbound),
          messageCount: 1,
          inboundCount: 1,
        },
      ],
      messages: [inbound],
    })

    const report = await repairConversationAggregates(store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(report.mismatchCandidates, 0)
    assert.deepEqual(report.repairIds, [])
    assert.deepEqual(report.repaired, [])
    assert.deepEqual(recomputeCalls, [])
  })

  it('tenant scope ignores other tenants on resume', async () => {
    const keep = msg({
      id: 'keep1',
      direction: 'inbound',
      content: 'mine',
      sentAt: '2026-09-20T10:00:00.000Z',
      tenantId: 't1',
      conversationId: 'conv-t1',
    })
    const other = msg({
      id: 'other1',
      direction: 'inbound',
      content: 'theirs',
      sentAt: '2026-09-20T10:00:00.000Z',
      tenantId: 't2',
      conversationId: 'conv-t2',
    })
    const { store, conversations, recomputeCalls } = createMemoryStore({
      conversations: [
        seedZeroConversation('conv-t1', keep, 't1'),
        seedZeroConversation('conv-t2', other, 't2'),
      ],
      messages: [keep, other],
    })

    const report = await repairConversationAggregates(store, {
      tenantId: 't1',
      touchedIds: [],
    })
    assert.equal(report.mismatchCandidates, 1)
    assert.deepEqual(report.repairIds, ['conv-t1'])
    assert.deepEqual(recomputeCalls, [['conv-t1']])
    assert.equal(conversations.get('conv-t1')?.messageCount, 1)
    assert.equal(conversations.get('conv-t2')?.messageCount, 0)
  })
})
