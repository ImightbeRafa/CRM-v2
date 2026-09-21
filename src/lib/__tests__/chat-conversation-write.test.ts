import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  isDeliveryStatusMonotonicUpgrade,
  DELIVERY_STATUS_RANK,
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

test('send route dual-writes conversation rows before/after Graph', () => {
  const source = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
  assert.match(source, /dualWriteChatMessage/)
  assert.match(source, /finalizeOutboundDelivery/)
  assert.doesNotMatch(source, /chatMessage\.create\(/)
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
