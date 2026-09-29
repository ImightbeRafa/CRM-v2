/** Phase 2b S5: snooze ("Posponer"). 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dtoIsSnoozed, isSnoozedNow, parseSnoozeUntil, SNOOZE_MAX_DAYS, snoozePresets } from '../chat-work-state'
import { filterSoftConversations, isSnoozedConversation, type SoftConversation } from '../chat-soft-copilot'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
const NOW = new Date('2026-09-29T15:00:00Z')
const H = 60 * 60 * 1000

test('snoozed while the time is in the future and the customer has not written since', () => {
  const ws = { snoozedAt: new Date(NOW.getTime() - H), snoozedUntil: new Date(NOW.getTime() + H) }
  assert.equal(isSnoozedNow(ws, null, NOW), true)
  assert.equal(isSnoozedNow(ws, new Date(NOW.getTime() - 2 * H), NOW), true, 'older inbound does not wake it')
  assert.equal(isSnoozedNow(ws, new Date(NOW.getTime() - 30 * 60_000), NOW), false, 'customer wrote after snoozing → wakes')
  assert.equal(isSnoozedNow({ ...ws, snoozedUntil: new Date(NOW.getTime() - 1) }, null, NOW), false, 'time passed → wakes')
  assert.equal(isSnoozedNow(null, null, NOW), false)
  assert.equal(isSnoozedNow({ snoozedAt: null, snoozedUntil: ws.snoozedUntil }, null, NOW), false)
})

test('until: future (>30 s), at most 90 days, strings only', () => {
  assert.ok(parseSnoozeUntil(new Date(NOW.getTime() + H).toISOString(), NOW))
  assert.equal(parseSnoozeUntil(new Date(NOW.getTime() + 10_000).toISOString(), NOW), null)
  assert.equal(parseSnoozeUntil(new Date(NOW.getTime() - H).toISOString(), NOW), null)
  assert.equal(parseSnoozeUntil(new Date(NOW.getTime() + (SNOOZE_MAX_DAYS + 1) * 24 * H).toISOString(), NOW), null)
  for (const bad of [123, null, undefined, 'mañana', {}]) assert.equal(parseSnoozeUntil(bad, NOW), null)
})

test('presets are all in the future; Monday is never today', () => {
  const monday = new Date(2026, 8, 28, 9, 0) // a Monday, 9:00 local
  const p = snoozePresets(monday)
  for (const x of p) assert.ok(x.until.getTime() > monday.getTime(), x.key)
  const next = p.find((x) => x.key === 'monday')!.until
  assert.equal(next.getDay(), 1)
  assert.equal(Math.round((next.getTime() - monday.getTime()) / (24 * H)), 7)
  assert.equal(next.getHours(), 8)
})

const conv = (over: Partial<SoftConversation>): SoftConversation =>
  ({
    recipientId: 'r1',
    socialAccountId: 'a1',
    platform: 'whatsapp',
    accountLabel: 'Línea',
    status: 'en_curso',
    tags: [],
    messages: [],
    unreadCount: 0,
    ...over,
  }) as SoftConversation

test('snoozed chats leave the working buckets and show in Pospuestos until they wake', () => {
  const later = new Date(NOW.getTime() + H).toISOString()
  const list = [conv({ recipientId: 'a' }), conv({ recipientId: 'b', snoozedUntil: later })]
  const base = { channel: 'todos' as const, accountId: 'all' as const, search: '', nowMs: NOW.getTime() }
  assert.deepEqual(filterSoftConversations(list, { ...base, bucket: 'abiertos' }).map((c) => c.recipientId), ['a'])
  assert.deepEqual(filterSoftConversations(list, { ...base, bucket: 'pospuestos' }).map((c) => c.recipientId), ['b'])
  // Two hours later it is back in Abiertos.
  const woke = { ...base, nowMs: NOW.getTime() + 2 * H }
  assert.deepEqual(filterSoftConversations(list, { ...woke, bucket: 'abiertos' }).map((c) => c.recipientId), ['a', 'b'])
  assert.equal(isSnoozedConversation({ snoozedUntil: null }), false)
  assert.equal(dtoIsSnoozed({ until: later, at: NOW.toISOString() }, NOW.getTime()), true)
})

test('server: tenant-scoped writes, revision bump, list never breaks before 036', () => {
  const src = read('src/lib/chat-work-state-server.ts')
  assert.match(src, /prisma\.chatConversation\.findFirst\(\{\s*where: \{ id: args\.conversationId, tenantId: args\.tenantId \}/)
  assert.match(src, /updateMany\(\{ where: \{ conversationId: conv\.id, tenantId: args\.tenantId \}, data \}\)/)
  assert.match(src, /chatConversation\.updateMany\(\{ where: \{ id: conversationId, tenantId \}, data: \{ updatedAt: new Date\(\) \} \}\)/)
  assert.match(src, /where: \{ tenantId, conversationId: \{ in: dtos\.map\(\(d\) => d\.id\) \}/)
  assert.match(src, /return dtos\n\s*\}\n\}/, 'errors return the list unchanged')
  const route = read('src/app/api/chat/conversations/[id]/snooze/route.ts')
  assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  assert.match(route, /workspaceWriteRateLimit\(/)
  for (const f of ['src/app/api/chat/conversations/route.ts', 'src/app/api/chat/conversations/changes/route.ts']) {
    assert.match(read(f), /attachSnoozeState\(auth\.tenantId,/, f)
  }
  // Webhook / inbound path untouched by Phase 2b.
  assert.doesNotMatch(read('src/lib/chat-conversation-write.ts'), /WorkState|snooze/i)
})
