import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  isDeliveryStatusMonotonicUpgrade,
  DELIVERY_STATUS_RANK,
  finalizeOutboundDeliveryWithClient,
  isPersistedDualWrite,
  shouldAdvanceConversationTimestamp,
  shouldReplaceConversationPreview,
  type FinalizeOutboundDeliveryResult,
} from '../chat-conversation-write'
import type { Prisma } from '@prisma/client'

test('delivery status upgrades are monotonic (read never regresses)', () => {
  assert.equal(isDeliveryStatusMonotonicUpgrade(null, 'pending'), true)
  assert.equal(isDeliveryStatusMonotonicUpgrade('pending', 'sent'), true)
  assert.equal(isDeliveryStatusMonotonicUpgrade('sent', 'delivered'), true)
  assert.equal(isDeliveryStatusMonotonicUpgrade('delivered', 'read'), true)
  assert.equal(isDeliveryStatusMonotonicUpgrade('read', 'delivered'), false)
  assert.equal(isDeliveryStatusMonotonicUpgrade('read', 'sent'), false)
  assert.equal(isDeliveryStatusMonotonicUpgrade('failed', 'delivered'), false)
  assert.equal(isDeliveryStatusMonotonicUpgrade('pending', 'failed'), true)
  assert.ok(DELIVERY_STATUS_RANK.read > DELIVERY_STATUS_RANK.delivered)
})

test('webhook route verifies HMAC before any IP rate limit', () => {
  const source = readFileSync('src/app/api/chat/webhook/route.ts', 'utf8')
  const verifyAt = source.indexOf('verifyMetaWebhookSignature')
  const invalidLimitAt = source.indexOf('chatWebhookInvalidSignatureRateLimit')
  const legacyLimitAt = source.indexOf('chatWebhookRateLimit(request)')
  assert.ok(verifyAt > 0, 'HMAC verify must be present')
  assert.ok(invalidLimitAt > verifyAt, 'invalid-signature limiter runs after HMAC')
  assert.equal(legacyLimitAt, -1, 'valid Meta traffic must not use legacy IP limiter first')
  assert.match(source, /dualWriteChatMessage/)
  assert.match(source, /applyDeliveryStatusUpdate/)
  assert.match(source, /applyPeerReadWatermark/)
})

test('send route stamps providerMessageId on first dual-write and accepts echo-first', () => {
  const source = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
  assert.match(source, /dualWriteChatMessage/)
  assert.match(source, /finalizeOutboundDelivery/)
  assert.match(source, /isPersistedDualWrite/)
  assert.match(source, /providerMessageId: providerMessageId \|\| null/)
  assert.doesNotMatch(source, /providerMessageId:\s*null/)
  assert.doesNotMatch(source, /chatMessage\.create\(/)
  assert.doesNotMatch(source, /write\.duplicate \|\| !write\.messageId/)
})

test('isPersistedDualWrite treats identified echo-first duplicate as success', () => {
  assert.equal(
    isPersistedDualWrite({
      ok: true,
      duplicate: true,
      messageId: 'msg-echo',
      conversationId: 'conv-1',
      reason: 'duplicate',
    }),
    true,
  )
  assert.equal(
    isPersistedDualWrite({
      ok: true,
      duplicate: false,
      messageId: 'msg-new',
      conversationId: 'conv-1',
      tenantId: 't1',
      socialAccountId: 'sa1',
      peerId: '506',
      direction: 'outbound',
      content: 'hola',
      peerName: null,
      suppressSoftAi: true,
    }),
    true,
  )
  assert.equal(
    isPersistedDualWrite({
      ok: true,
      duplicate: true,
      messageId: null,
      conversationId: null,
      reason: 'duplicate',
    }),
    false,
  )
  assert.equal(isPersistedDualWrite({ ok: false, reason: 'error' }), false)
})

test('conversation aggregates keep newer (sentAt, id) preview and direction maxima', () => {
  const newer = new Date('2026-09-21T12:00:00.000Z')
  const older = new Date('2026-09-21T11:00:00.000Z')
  assert.equal(
    shouldReplaceConversationPreview(
      { lastMessageAt: newer, lastMessageId: 'msg-new' },
      { sentAt: older, messageId: 'msg-old' },
    ),
    false,
  )
  assert.equal(
    shouldReplaceConversationPreview(
      { lastMessageAt: older, lastMessageId: 'msg-old' },
      { sentAt: newer, messageId: 'msg-new' },
    ),
    true,
  )
  assert.equal(
    shouldReplaceConversationPreview(
      { lastMessageAt: newer, lastMessageId: 'aaa' },
      { sentAt: newer, messageId: 'zzz' },
    ),
    true,
  )
  assert.equal(
    shouldReplaceConversationPreview(
      { lastMessageAt: newer, lastMessageId: 'zzz' },
      { sentAt: newer, messageId: 'aaa' },
    ),
    false,
  )
  assert.equal(
    shouldReplaceConversationPreview(
      { lastMessageAt: null, lastMessageId: null },
      { sentAt: older, messageId: 'msg-old' },
    ),
    true,
  )
  assert.equal(shouldAdvanceConversationTimestamp(newer, older), false)
  assert.equal(shouldAdvanceConversationTimestamp(older, newer), true)
  assert.equal(shouldAdvanceConversationTimestamp(newer, newer), false)
  assert.equal(shouldAdvanceConversationTimestamp(null, older), true)

  const writeSrc = readFileSync('src/lib/chat-conversation-write.ts', 'utf8')
  assert.match(writeSrc, /shouldReplaceConversationPreview/)
  assert.match(writeSrc, /shouldAdvanceConversationTimestamp/)
  assert.match(writeSrc, /FOR UPDATE/)
  assert.match(writeSrc, /\$queryRaw/)
  assert.match(writeSrc, /inboundCount = \{ increment: 1 \}/)
})

function createFinalizeTx(opts: {
  existing: {
    id: string
    deliveryStatus: string
    metadata: unknown
    providerMessageId: string | null
  } | null
  conversation?: {
    inboundCount: number
    lastMessageId: string | null
    lastOutboundAt: Date | null
  } | null
}) {
  const calls = {
    messageUpdates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
    conversationUpdates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
    readUpserts: [] as Array<{
      where: { conversationId_userId: { conversationId: string; userId: string } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }>,
  }
  const conversation =
    opts.conversation === undefined
      ? {
          inboundCount: 4,
          lastMessageId: 'last-1',
          lastOutboundAt: new Date('2026-09-20T00:00:00.000Z'),
        }
      : opts.conversation

  const tx = {
    chatMessage: {
      findFirst: async () => opts.existing,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.messageUpdates.push(args)
        return args
      },
    },
    chatConversation: {
      findUnique: async () => conversation,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.conversationUpdates.push(args)
        return args
      },
    },
    chatConversationReadState: {
      upsert: async (args: {
        where: { conversationId_userId: { conversationId: string; userId: string } }
        create: Record<string, unknown>
        update: Record<string, unknown>
      }) => {
        calls.readUpserts.push(args)
        return args
      },
    },
  }
  return { tx: tx as unknown as Prisma.TransactionClient, calls }
}

const FINALIZE_BASE = {
  messageId: 'msg-echo',
  tenantId: 't1',
  conversationId: 'conv-1',
  userId: 'user-1',
  providerMessageId: 'wamid.echo',
  deliveryStatus: 'sent' as const,
  providerResponse: { messages: [{ id: 'wamid.echo' }] },
  now: new Date('2026-09-21T12:00:00.000Z'),
}

test('echo-first finalize still merges metadata and upserts sender read-state', async () => {
  const { tx, calls } = createFinalizeTx({
    existing: {
      id: 'msg-echo',
      deliveryStatus: 'sent',
      metadata: { providerMessageId: 'wamid.echo', to: '506' },
      providerMessageId: 'wamid.echo',
    },
  })
  const result: FinalizeOutboundDeliveryResult = await finalizeOutboundDeliveryWithClient(
    tx,
    FINALIZE_BASE,
  )
  assert.equal(result, 'reconciled')
  assert.equal(calls.messageUpdates.length, 1)
  assert.equal(calls.messageUpdates[0]?.data.deliveryStatus, undefined)
  const meta = calls.messageUpdates[0]?.data.metadata as Record<string, unknown>
  assert.deepEqual(meta.providerResponse, { messages: [{ id: 'wamid.echo' }] })
  assert.equal(calls.readUpserts.length, 1)
  assert.equal(calls.readUpserts[0]?.where.conversationId_userId.userId, 'user-1')
  assert.equal(calls.readUpserts[0]?.update.readInboundCount, 4)
  assert.equal(calls.conversationUpdates.length, 1)
})

test('finalize does not regress delivered/read and still runs send side effects', async () => {
  const { tx, calls } = createFinalizeTx({
    existing: {
      id: 'msg-echo',
      deliveryStatus: 'read',
      metadata: { providerMessageId: 'wamid.echo' },
      providerMessageId: 'wamid.echo',
    },
  })
  const result = await finalizeOutboundDeliveryWithClient(tx, FINALIZE_BASE)
  assert.equal(result, 'reconciled')
  assert.equal(calls.messageUpdates[0]?.data.deliveryStatus, undefined)
  assert.equal(calls.readUpserts.length, 1)
})

test('pending outbound still upgrades to sent', async () => {
  const { tx, calls } = createFinalizeTx({
    existing: {
      id: 'msg-new',
      deliveryStatus: 'pending',
      metadata: { to: '506' },
      providerMessageId: null,
    },
  })
  const result = await finalizeOutboundDeliveryWithClient(tx, {
    ...FINALIZE_BASE,
    messageId: 'msg-new',
  })
  assert.equal(result, 'updated')
  assert.equal(calls.messageUpdates[0]?.data.deliveryStatus, 'sent')
  assert.equal(calls.messageUpdates[0]?.data.providerMessageId, 'wamid.echo')
  assert.equal(calls.readUpserts.length, 1)
})

test('missing outbound row skips all finalize side effects', async () => {
  const { tx, calls } = createFinalizeTx({ existing: null })
  const result = await finalizeOutboundDeliveryWithClient(tx, FINALIZE_BASE)
  assert.equal(result, 'missing')
  assert.equal(calls.messageUpdates.length, 0)
  assert.equal(calls.conversationUpdates.length, 0)
  assert.equal(calls.readUpserts.length, 0)
})

test('finalize does not regress lastOutboundAt when echo already has a newer stamp', async () => {
  const newer = new Date('2026-09-21T13:00:00.000Z')
  const { tx, calls } = createFinalizeTx({
    existing: {
      id: 'msg-echo',
      deliveryStatus: 'sent',
      metadata: {},
      providerMessageId: 'wamid.echo',
    },
    conversation: {
      inboundCount: 1,
      lastMessageId: 'msg-echo',
      lastOutboundAt: newer,
    },
  })
  await finalizeOutboundDeliveryWithClient(tx, FINALIZE_BASE)
  assert.equal(calls.conversationUpdates.length, 0)
  assert.equal(calls.readUpserts.length, 1)
})

test('025 unique SQL ships gated and is not default-applied', () => {
  const sql = readFileSync('supabase/migrations/025_chat_inbox_uniques.sql', 'utf8')
  const manifest = readFileSync('scripts/lib/betsy-v2-additive-manifest.mjs', 'utf8')
  assert.match(sql, /ChatMessage_socialAccountId_providerMessageId_uidx/)
  assert.match(sql, /SocialAccount_platform_accountId_active_uidx/)
  assert.match(manifest, /'025': '025_chat_inbox_uniques\.sql'/)
  assert.match(manifest, /DEFAULT_APPLY_FILES = '018,019,020,021,022,023,024'/)
  assert.doesNotMatch(manifest, /DEFAULT_APPLY_FILES = '[^']*025/)
})
