/** Phase 2b S2: quick reply usage + first response time after human sends. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { firstResponseDedupeKey, firstResponseMs, sanitizeQuickReplyShortcut } from '../chat-send-metrics'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('quick reply shortcut: normalized, well-formed keys only', () => {
  assert.equal(sanitizeQuickReplyShortcut('/Envío'), 'envio')
  assert.equal(sanitizeQuickReplyShortcut('precio-2'), 'precio-2')
  assert.equal(sanitizeQuickReplyShortcut('hola mundo'), 'hola-mundo')
  for (const bad of ['', '////', null, undefined, 42, {}, 'x'.repeat(61), '<script>']) {
    const out = sanitizeQuickReplyShortcut(bad)
    assert.ok(out === null || /^[a-z0-9_-]{1,40}$/.test(out), String(bad))
  }
  assert.equal(sanitizeQuickReplyShortcut(''), null)
  assert.equal(sanitizeQuickReplyShortcut('x'.repeat(61)), null)
})

test('first response: positive gap only, one dedupe key per chat', () => {
  const a = new Date('2026-09-29T10:00:00Z')
  const b = new Date('2026-09-29T10:03:30Z')
  assert.equal(firstResponseMs(a, b), 210_000)
  assert.equal(firstResponseMs(b, a), null, 'reply before any inbound (outbound-first chat) is not a response')
  assert.equal(firstResponseMs(null, b), null)
  assert.equal(firstResponseMs(a, null), null)
  assert.equal(firstResponseDedupeKey('c1'), 'first_response:c1')
})

test('only a true first reply of a NEW chat records it; any earlier outbound (app, AI, pre-031) skips', () => {
  const src = read('src/lib/chat-send-metrics.ts')
  // Only human sends call this (send paths guard on senderUser); here the FIRST outbound of any
  // kind after the first inbound must be this very message.
  assert.match(src, /direction: 'outbound', sentAt: \{ gte: firstInbound\.sentAt \}/)
  assert.match(src, /if \(!firstOutbound \|\| firstOutbound\.id !== args\.messageId\) return settle\(memoKey\)/)
  assert.match(src, /firstInbound\.sentAt\.getTime\(\) < FIRST_RESPONSE_SINCE\.getTime\(\)\) return settle\(memoKey\)/)
  assert.match(src, /if \(settledChats\.has\(memoKey\)\) return/, 'settled chats cost no more queries')
  assert.match(src, /dedupeKey,\n\s*\}\)/)
  // Every query is tenant-scoped.
  assert.equal((src.match(/where: \{ tenantId: args\.tenantId,/g) || []).length, 3)
  // Never throws into the send path.
  assert.match(src, /catch \(error\) \{\n\s*\/\/ Metrics must never break a send/)
})

test('send paths call the metrics fire-and-forget, only for delivered human sends', () => {
  for (const f of ['src/app/api/chat/send/route.ts', 'src/lib/chat-send-media-core.ts']) {
    const src = read(f)
    assert.match(src, /void recordHumanSendMetrics\(\{/, f)
    assert.doesNotMatch(src, /await recordHumanSendMetrics/, f)
    // Inside the same guard as auto-assign: provider accepted + a human sender.
    const guard = src.indexOf('if (providerMessageId && write.conversationId && senderUser)')
    const call = src.indexOf('void recordHumanSendMetrics')
    assert.ok(guard > 0 && call > guard && call - guard < 500, f)
  }
})

test('composer reports the inserted quick reply only for the chat it was used in', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /quickReplyUsedRef\.current\?\.conversationId === conversationId/)
  assert.match(inbox, /!opts\?\.retryClientRequestId &&/)
  assert.match(read('src/components/chats/SoftThreadPane.tsx'), /quickReplies\?\.onUsed\?\.\(reply\.shortcut\)/)
})
