import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { outboundMediaContent } from '@/lib/chat-outbound-media'

const inbox = () => readFileSync('src/components/chats/SoftCopilotInboxV2.tsx', 'utf8')
const pane = () => readFileSync('src/components/chats/SoftThreadPane.tsx', 'utf8')

test('F1: inbox opens on every open chat (new chats have no owner yet)', () => {
  assert.match(inbox(), /useState<InboxBucket>\('abiertos'\)/)
})

test('F2: network failures while loading a thread show the error state; retry shows loading', () => {
  assert.match(inbox(), /await fetchThreadMessages\(conversationId\)\s*\} catch \{[\s\S]*?setThreadErrorId\(conversationId\)/)
  assert.match(inbox(), /onRetryThread: \(\) => \{\s*if \(selectedConversationId\) void loadThreadMessages/)
})

test('F3: a retried file is deduplicated and a sent-but-unsaved file clears the chip', () => {
  const route = readFileSync('src/lib/chat-send-media-core.ts', 'utf8')
  assert.match(route, /metadata: \{ path: \['clientRequestId'\], equals: clientRequestId \}/)
  assert.match(route, /\{ sent: true \}/)
  assert.match(inbox(), /pendingFileRequestIds\.current/)
  assert.match(inbox(), /if \(alreadySent\) \{/)
})

test('F4: audio never stores a caption the customer did not receive', () => {
  assert.equal(outboundMediaContent('audio', 'Te mando las instrucciones'), '[audio]')
  assert.equal(outboundMediaContent('image', 'Hola'), 'Hola')
})

test('F7: desktop header only renders when not compact (no double header on mobile)', () => {
  assert.match(pane(), /\{!compact \? \(\s*<header className="shrink-0 border-b border-slate-200\/70 px-4 py-3 sm:px-5">/)
})

test('F5/F6: stale data keeps a banner instead of a full error block', () => {
  assert.match(readFileSync('src/app/config/social/components/ChannelsTable.tsx', 'utf8'), /loadError && totalCount === 0/)
  assert.match(readFileSync('src/app/produccion/components/EnhancedProductionDashboard.tsx', 'utf8'), /orders\.length === 0 \? \(\s*<AuroraErrorState/)
})
