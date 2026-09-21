import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  isDeliveryStatusMonotonicUpgrade,
  DELIVERY_STATUS_RANK,
  isPersistedDualWrite,
  shouldAdvanceConversationTimestamp,
  shouldReplaceConversationPreview,
} from '../chat-conversation-write'

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

test('025 unique SQL ships gated and is not default-applied', () => {
  const sql = readFileSync('supabase/migrations/025_chat_inbox_uniques.sql', 'utf8')
  const manifest = readFileSync('scripts/lib/betsy-v2-additive-manifest.mjs', 'utf8')
  assert.match(sql, /ChatMessage_socialAccountId_providerMessageId_uidx/)
  assert.match(sql, /SocialAccount_platform_accountId_active_uidx/)
  assert.match(manifest, /'025': '025_chat_inbox_uniques\.sql'/)
  assert.match(manifest, /DEFAULT_APPLY_FILES = '018,019,020,021,022,023,024'/)
  assert.doesNotMatch(manifest, /DEFAULT_APPLY_FILES = '[^']*025/)
})
