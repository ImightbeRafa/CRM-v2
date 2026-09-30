import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import type { Prisma } from '@prisma/client'
import { mapConversationToListDto, unreadInboundCount, type ConversationRow } from '../chat-conversation-api'
import { bumpConversationAfterInsert, isConfirmedReplyStatus } from '../chat-conversation-write'
import { FILES, EXPECTED_COLUMNS, VERIFY_CATALOG_COLUMNS } from '../../../scripts/lib/betsy-v2-additive-manifest.mjs'

test('a teammate reply clears pending for everyone; later customer messages count again', () => {
  // Customer sent 3; nobody read or answered.
  assert.equal(unreadInboundCount({ inboundCount: 3, readInboundCount: 0, repliedInboundCount: 0 }), 3)
  // Mom answered (team replied up to 3): other users' badge is gone without opening the chat.
  assert.equal(unreadInboundCount({ inboundCount: 3, readInboundCount: 0, repliedInboundCount: 3 }), 0)
  // Customer writes 2 more after the reply: pending again, only the new ones.
  assert.equal(unreadInboundCount({ inboundCount: 5, readInboundCount: 0, repliedInboundCount: 3 }), 2)
  // A viewer who read further than the team reply sees their own read state.
  assert.equal(unreadInboundCount({ inboundCount: 5, readInboundCount: 4, repliedInboundCount: 3 }), 1)
  // Missing column (old rows / fixtures) behaves exactly like before.
  assert.equal(unreadInboundCount({ inboundCount: 2, readInboundCount: 1 }), 1)
  // Never negative, even with inconsistent counters.
  assert.equal(unreadInboundCount({ inboundCount: 1, readInboundCount: 0, repliedInboundCount: 9 }), 0)
})

test('list DTO uses the team-aware count', () => {
  const row = {
    id: 'c1',
    tenantId: 't1',
    socialAccountId: 's1',
    peerId: '506',
    peerName: null,
    peerAvatarUrl: null,
    clientId: null,
    status: 'nuevo',
    assignedUserId: null,
    aiMode: null,
    tags: [],
    lastMessageId: null,
    lastMessageAt: new Date(),
    lastMessagePreview: null,
    lastMessageDirection: 'outbound',
    lastInboundAt: null,
    inboundCount: 4,
    repliedInboundCount: 4,
    readInboundCount: 0,
    revision: BigInt(1),
    socialAccount: null,
  } as unknown as ConversationRow
  assert.equal(mapConversationToListDto(row).unreadCount, 0)
})

test('only replies Meta accepted count as answered', () => {
  for (const s of ['sent', 'delivered', 'read']) assert.equal(isConfirmedReplyStatus(s), true)
  for (const s of ['pending', 'failed', 'received', null, undefined, '']) assert.equal(isConfirmedReplyStatus(s), false)
})

type Msg = { id: string; direction: 'inbound' | 'outbound'; sentAt: Date; duplicateOfMessageId?: string | null }

/** Fake tx over an in-memory message list; records the conversation update. */
function fakeTx(opts: { inboundCount: number; repliedInboundCount: number; messages: Msg[] }) {
  const calls = {
    locks: 0,
    update: null as null | Record<string, unknown>,
    triggerLookups: [] as unknown[],
  }
  const tx = {
    $queryRaw: async () => {
      calls.locks += 1
      return []
    },
    chatConversation: {
      findUnique: async () => ({
        lastMessageAt: new Date('2026-01-01'),
        lastMessageId: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        inboundCount: opts.inboundCount,
        repliedInboundCount: opts.repliedInboundCount,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        calls.update = args.data
        return args
      },
    },
    chatMessage: {
      findFirst: async (args: { where: { id: string; direction: string } }) => {
        calls.triggerLookups.push(args.where)
        const m = opts.messages.find((x) => x.id === args.where.id && x.direction === args.where.direction)
        return m ? { sentAt: m.sentAt } : null
      },
      count: async (args: {
        where: { direction: string; duplicateOfMessageId: null; sentAt: { lte: Date } }
      }) =>
        opts.messages.filter(
          (m) =>
            m.direction === args.where.direction &&
            (args.where.duplicateOfMessageId === null ? !m.duplicateOfMessageId : true) &&
            m.sentAt <= args.where.sentAt.lte,
        ).length,
    },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, calls }
}

const t = (min: number) => new Date(Date.UTC(2026, 8, 30, 12, min))
type BumpArgs = Parameters<typeof bumpConversationAfterInsert>[1]
const bumpArgs = (over: Partial<BumpArgs>): BumpArgs => ({
  conversationId: 'conv-1',
  messageId: 'out-1',
  direction: 'outbound',
  deliveryStatus: 'sent',
  content: 'hola',
  sentAt: t(10),
  peerName: null,
  existingPeerName: 'x',
  existingClientId: 'client-1',
  tenantId: 't1',
  peerId: '506',
  ...over,
})

test('bump: a phone / echo reply answers only the customer messages sent before it', async () => {
  const messages: Msg[] = [
    { id: 'in-1', direction: 'inbound', sentAt: t(1) },
    { id: 'in-2', direction: 'inbound', sentAt: t(2) },
    { id: 'in-3', direction: 'inbound', sentAt: t(20) }, // arrived after the echo's send time
  ]
  const { tx, calls } = fakeTx({ inboundCount: 3, repliedInboundCount: 0, messages })
  await bumpConversationAfterInsert(tx, bumpArgs({ sentAt: t(10) }))
  assert.equal(calls.locks, 1)
  assert.equal(calls.update?.repliedInboundCount, 2)
})

test('bump: an AI reply marks only up to the message it answered (not ones that came while thinking)', async () => {
  const messages: Msg[] = [
    { id: 'in-A', direction: 'inbound', sentAt: t(1) },
    { id: 'in-B', direction: 'inbound', sentAt: t(2) },
  ]
  const { tx, calls } = fakeTx({ inboundCount: 2, repliedInboundCount: 0, messages })
  await bumpConversationAfterInsert(tx, bumpArgs({ sentAt: t(5), answersMessageId: 'in-A' }))
  assert.equal(calls.update?.repliedInboundCount, 1)
  // Trigger lookup is tenant + conversation scoped and inbound only.
  assert.deepEqual(calls.triggerLookups[0], {
    id: 'in-A',
    tenantId: 't1',
    conversationId: 'conv-1',
    direction: 'inbound',
  })
})

test('bump: an unknown / foreign trigger id falls back to the reply time, never later', async () => {
  const messages: Msg[] = [
    { id: 'in-A', direction: 'inbound', sentAt: t(1) },
    { id: 'in-B', direction: 'inbound', sentAt: t(9) },
  ]
  const { tx, calls } = fakeTx({ inboundCount: 2, repliedInboundCount: 0, messages })
  await bumpConversationAfterInsert(tx, bumpArgs({ sentAt: t(5), answersMessageId: 'other-tenant-msg' }))
  assert.equal(calls.update?.repliedInboundCount, 1)
})

test('bump: pending / failed outbound and inbound never mark; the marker never goes down', async () => {
  const messages: Msg[] = [{ id: 'in-1', direction: 'inbound', sentAt: t(1) }]
  for (const deliveryStatus of ['pending', 'failed'] as const) {
    const { tx, calls } = fakeTx({ inboundCount: 1, repliedInboundCount: 0, messages })
    await bumpConversationAfterInsert(tx, bumpArgs({ deliveryStatus }))
    assert.equal(Boolean(calls.update && 'repliedInboundCount' in calls.update), false)
  }
  const inbound = fakeTx({ inboundCount: 1, repliedInboundCount: 0, messages })
  await bumpConversationAfterInsert(inbound.tx, bumpArgs({ direction: 'inbound', deliveryStatus: 'received' }))
  assert.equal(Boolean(inbound.calls.update && 'repliedInboundCount' in inbound.calls.update), false)
  // Old WhatsApp history (sent long ago) never lowers an already-higher marker.
  const history = fakeTx({ inboundCount: 3, repliedInboundCount: 3, messages })
  await bumpConversationAfterInsert(history.tx, bumpArgs({ sentAt: t(0) }))
  assert.equal(Boolean(history.calls.update && 'repliedInboundCount' in history.calls.update), false)
})

test('bump: legacy duplicate inbound rows are not counted and the counter caps the result', async () => {
  const messages: Msg[] = [
    { id: 'in-1', direction: 'inbound', sentAt: t(1) },
    { id: 'in-1-dup', direction: 'inbound', sentAt: t(1), duplicateOfMessageId: 'in-1' },
    { id: 'in-2', direction: 'inbound', sentAt: t(2) },
  ]
  const { tx, calls } = fakeTx({ inboundCount: 2, repliedInboundCount: 0, messages })
  await bumpConversationAfterInsert(tx, bumpArgs({}))
  assert.equal(calls.update?.repliedInboundCount, 2)
})

test('AI callers pass the answered trigger; async failed status recomputes; finalize is locked + tenant scoped', () => {
  for (const f of ['src/lib/soft-ai/agent-turn.ts', 'src/lib/soft-ai/automation-processor.ts']) {
    assert.match(readFileSync(f, 'utf8'), /answersMessageId: (input\.)?row\.messageId/)
  }
  const src = readFileSync('src/lib/chat-conversation-write.ts', 'utf8')
  const fin = src.slice(src.indexOf('export async function finalizeOutboundDeliveryWithClient'))
  assert.match(
    fin,
    /if \(args\.deliveryStatus === 'sent'\) \{\s*await tx\.\$queryRaw`SELECT 1 FROM "ChatConversation" WHERE id = \$\{args\.conversationId\} AND "tenantId" = \$\{args\.tenantId\} FOR UPDATE`/,
  )
  assert.match(fin, /countTeamAnsweredInbound\(tx, args\.conversationId, existing\.sentAt, conversation\.inboundCount\)/)
  assert.match(fin, /findFirst\(\{\s*where: \{ id: args\.conversationId, tenantId: args\.tenantId \}/)
  const status = src.slice(src.indexOf('export async function applyDeliveryStatusUpdate'))
  assert.match(status, /args\.status === 'failed' && message\.direction === 'outbound'/)
  assert.match(status, /recomputeTeamRepliedAfterFailure\(tx, conversationId, message\.tenantId\)/)
  const rec = src.slice(src.indexOf('async function recomputeTeamRepliedAfterFailure'))
  assert.match(rec, /FOR UPDATE/)
  assert.match(rec, /deliveryStatus: \{ in: \['sent', 'delivered', 'read'\] \}/)
  assert.match(rec, /if \(replied < conversation\.repliedInboundCount\)/)
})

test('SQL 037 is additive, gated, split and registered', () => {
  assert.equal(FILES['037'], '037_chat_team_replied.sql')
  assert.deepEqual(EXPECTED_COLUMNS['037'], [['ChatConversation', 'repliedInboundCount']])
  assert.ok(VERIFY_CATALOG_COLUMNS.some(([tbl, col]) => tbl === 'ChatConversation' && col === 'repliedInboundCount'))
  const sql = readFileSync('supabase/migrations/037_chat_team_replied.sql', 'utf8')
  const code = sql.replace(/--[^\n]*/g, '')
  assert.match(code, /ADD COLUMN IF NOT EXISTS "repliedInboundCount" integer NOT NULL DEFAULT 0/)
  // The column add commits on its own before the backfill (lock released at once).
  const firstCommit = code.indexOf('COMMIT;')
  assert.ok(code.indexOf('ADD COLUMN') < firstCommit && code.indexOf('WITH last_reply') > firstCommit)
  assert.match(code, /"duplicateOfMessageId" IS NULL/)
  assert.doesNotMatch(code, /\b(DROP|TRUNCATE|DELETE)\b/i)
  // Backfill only raises the value and only writes that column.
  assert.match(code, /computed\.replied > c\."repliedInboundCount"/)
  const set = code.slice(code.indexOf('SET "repliedInboundCount"'), code.indexOf('FROM computed'))
  assert.doesNotMatch(set, /,/)
  assert.match(code, /"deliveryStatus" IN \('sent', 'delivered', 'read'\)/)
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /repliedInboundCount\s+Int\s+@default\(0\)/)
})
