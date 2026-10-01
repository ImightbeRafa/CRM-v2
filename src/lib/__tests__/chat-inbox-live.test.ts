import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  CHAT_INBOX_V2_STUCK_POLL_MS,
  decideInboxV2PollTick,
  inboxFetch,
} from '../chat-inbox-v2-client'
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
  assert.equal(isNewInboundActivity(undefined, { unreadCount: 1, lastMessageDirection: 'inbound' }), true, 'brand-new chat')
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
