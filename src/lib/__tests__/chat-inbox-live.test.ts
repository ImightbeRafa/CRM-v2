import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  CHAT_INBOX_V2_STUCK_POLL_MS,
  decideInboxV2PollTick,
  inboxFetch,
  mergeListDtoIntoMap,
  threadTailCursor,
} from '../chat-inbox-v2-client'
import type { ChatConversationListItemDto } from '../chat-conversation-api'
import { isNewInboundActivity } from '../notification-sound'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

test('a stuck poll no longer blocks the inbox (reported: new messages only after refresh)', () => {
  const base = { documentHidden: false, nowMs: 100_000, lastFullReconcileMs: 99_000, fullReconcileEveryMs: 120_000 }
  // In flight and recent → skip (normal back-pressure).
  assert.deepEqual(decideInboxV2PollTick({ ...base, inFlight: true, inFlightSinceMs: 100_000 - 5_000 }), { action: 'skip', reason: 'in_flight' })
  // In flight for longer than the stuck limit → polling resumes.
  assert.deepEqual(decideInboxV2PollTick({ ...base, inFlight: true, inFlightSinceMs: 100_000 - CHAT_INBOX_V2_STUCK_POLL_MS }), { action: 'changes' })
  // Old callers without a start time keep the previous behaviour.
  assert.deepEqual(decideInboxV2PollTick({ ...base, inFlight: true }), { action: 'skip', reason: 'in_flight' })
  // Hidden tabs still never poll.
  assert.deepEqual(decideInboxV2PollTick({ ...base, documentHidden: true, inFlight: false }), { action: 'skip', reason: 'hidden' })
})

test('inbox requests are abandoned after the timeout instead of hanging forever', async () => {
  const realFetch = globalThis.fetch
  let sawSignal = false
  globalThis.fetch = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      sawSignal = Boolean(init?.signal)
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })) as typeof fetch
  try {
    const started = Date.now()
    await assert.rejects(inboxFetch('/api/chat/conversations/changes', {}, 50), /aborted/)
    assert.ok(Date.now() - started < 1000)
    assert.equal(sawSignal, true)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('the V2 inbox uses the timeout on every poll request and frees a superseded poll correctly', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /await inboxFetch\(`\/api\/chat\/conversations\?\$\{qs\.toString\(\)\}`/)
  assert.match(inbox, /await inboxFetch\(`\/api\/chat\/conversations\/changes\?\$\{qs\}`/)
  assert.match(inbox, /inFlightSinceMs: pollStartedAtRef\.current/)
  assert.match(inbox, /if \(pollStartedAtRef\.current === startedAt\) pollInFlightRef\.current = false/)
  assert.match(read('src/components/chats/SoftCopilotInboxLegacy.tsx'), /await inboxFetch\(\s*`\/api\/chat\/messages\?socialAccountId=/)
})

test('chime only for a customer message that raised the unread count', () => {
  assert.equal(isNewInboundActivity(0, { unreadCount: 1, lastMessageDirection: 'inbound' }), true)
  const now = Date.parse('2026-10-01T12:00:00.000Z')
  const recent = '2026-10-01T11:59:30.000Z'
  assert.equal(
    isNewInboundActivity(undefined, { unreadCount: 1, lastMessageDirection: 'inbound', lastInboundAt: recent }, now),
    true,
    'brand-new chat (not on screen) with a fresh customer message',
  )
  assert.equal(
    isNewInboundActivity(undefined, { unreadCount: 2, lastMessageDirection: 'inbound', lastInboundAt: '2026-09-30T08:00:00.000Z' }, now),
    false,
    'old unanswered chat outside the list that a teammate tagged / assigned',
  )
  assert.equal(isNewInboundActivity(undefined, { unreadCount: 1, lastMessageDirection: 'inbound' }, now), false, 'no inbound time')
  assert.equal(isNewInboundActivity(2, { unreadCount: 3, lastMessageDirection: 'inbound' }), true)
  assert.equal(isNewInboundActivity(1, { unreadCount: 1, lastMessageDirection: 'inbound' }), false, 'nothing new')
  assert.equal(isNewInboundActivity(0, { unreadCount: 0, lastMessageDirection: 'outbound' }), false, 'our own reply')
  assert.equal(isNewInboundActivity(3, { unreadCount: 0, lastMessageDirection: 'outbound' }), false, 'teammate answered')
  assert.equal(isNewInboundActivity(0, { unreadCount: 2, lastMessageDirection: 'outbound' }), false)
})

test('chime is calm and controllable: low volume, rate-limited, per-person off switch, first-load silent', () => {
  const sound = read('src/lib/notification-sound.ts')
  assert.match(sound, /const VOLUME = 0\.12/)
  assert.match(sound, /const MIN_GAP_MS = 4000/)
  assert.match(sound, /localStorage\.getItem\(STORAGE_KEY\) !== 'off'/)
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /if \(lastFullReconcileRef\.current > 0\) \{/)
  assert.match(inbox, /installNotificationSoundUnlock\(\)/)
  assert.match(read('src/components/chats/SoftConversationList.tsx'), /lastSyncAt !== undefined \? <SoundToggle \/> : null/)
})

test('open chat re-asks a short window back, so a customer message stamped just before our reply is not skipped', () => {
  assert.equal(threadTailCursor(undefined), null)
  assert.equal(
    threadTailCursor({ sentAt: '2026-10-01T12:00:05.700Z', id: 'm9' }),
    '2026-10-01T11:59:20.700Z,m9',
  )
  // The window must stay far below the 50-row tail page or a busy chat could stall on the same page.
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /const threadAfter = threadId \? threadTailCursor\(persistedTail\) : null/)
  assert.match(read('src/lib/chat-inbox-v2-client.ts'), /export const CHAT_INBOX_V2_THREAD_LOOKBACK_MS = 45_000/)
})

test('a late, older copy of a chat never replaces a newer one', () => {
  const row = (revision: string, lastMessage: string) =>
    ({ id: 'c1', revision, lastMessage } as unknown as ChatConversationListItemDto)
  let map = mergeListDtoIntoMap(new Map(), [row('10', 'new')])
  map = mergeListDtoIntoMap(map, [row('9', 'old')])
  assert.equal(map.get('c1')?.lastMessage, 'new')
  map = mergeListDtoIntoMap(map, [row('11', 'newer')])
  assert.equal(map.get('c1')?.lastMessage, 'newer')
})

test('first load blocks the poller with a real start time and only releases what it owns', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(
    inbox,
    /const startedAt = Date\.now\(\)\n\s+pollStartedAtRef\.current = startedAt\n\s+pollInFlightRef\.current = true\n\s+try \{\n\s+\/\/ Fresh on mount/,
  )
  assert.equal((inbox.match(/if \(pollStartedAtRef\.current === startedAt\) pollInFlightRef\.current = false/g) || []).length, 2)
})

test('sound unlocks from a completed tap on phones and the mobile header has the off switch', () => {
  const sound = read('src/lib/notification-sound.ts')
  assert.match(sound, /'pointerup', 'touchend', 'click'/)
  assert.match(sound, /visibilitychange/)
  assert.match(read('src/components/chats/SoftConversationList.tsx'), /lastSyncAt !== undefined \? <SoundToggle size="lg" \/> : null/)
})
