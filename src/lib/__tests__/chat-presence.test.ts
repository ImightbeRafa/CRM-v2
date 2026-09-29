/** Phase 2b S3: presence store + route guards. 2026-09-29. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parsePresenceState, PRESENCE_TTL_MS, PresenceStore, presenceLabel, TYPING_TTL_MS } from '../chat-presence'

const read = (f: string) => readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

test('entries expire after the TTL; the caller never sees themself', () => {
  const s = new PresenceStore()
  s.touch('t1', 'c1', { userId: 'ana', name: 'Ana', state: 'viewing' }, 1_000)
  s.touch('t1', 'c1', { userId: 'me', name: 'Yo', state: 'viewing' }, 1_000)
  assert.deepEqual(s.list('t1', 'c1', 'me', 2_000).map((p) => p.userId), ['ana'])
  assert.deepEqual(s.list('t1', 'c1', 'me', 1_000 + PRESENCE_TTL_MS + 1), [])
})

test('tenant isolation: same conversation id in another business shows nobody', () => {
  const s = new PresenceStore()
  s.touch('t1', 'c1', { userId: 'ana', name: 'Ana', state: 'typing' }, 1_000)
  assert.deepEqual(s.list('t2', 'c1', 'me', 1_500), [])
})

test('typing first, and typing decays to viewing after a pause', () => {
  const s = new PresenceStore()
  s.touch('t1', 'c1', { userId: 'luis', name: 'Luis', state: 'viewing' }, 1_000)
  s.touch('t1', 'c1', { userId: 'ana', name: 'Ana', state: 'typing' }, 1_000)
  assert.deepEqual(s.list('t1', 'c1', 'me', 1_500).map((p) => `${p.userId}:${p.state}`), ['ana:typing', 'luis:viewing'])
  assert.equal(s.list('t1', 'c1', 'me', 1_000 + TYPING_TTL_MS + 1).find((p) => p.userId === 'ana')?.state, 'viewing')
})

test('leave removes me; prune drops empty rooms', () => {
  const s = new PresenceStore()
  s.touch('t1', 'c1', { userId: 'ana', name: 'Ana', state: 'viewing' }, 1_000)
  s.leave('t1', 'c1', 'ana')
  assert.deepEqual(s.list('t1', 'c1', 'me', 1_100), [])
  s.touch('t1', 'c2', { userId: 'ana', name: 'Ana', state: 'viewing' }, 1_000)
  s.prune(1_000 + PRESENCE_TTL_MS + 1)
  assert.equal(s.size(), 0)
})

test('labels in Spanish', () => {
  assert.equal(presenceLabel([]), '')
  assert.equal(presenceLabel([{ name: 'Ana', state: 'typing' }]), 'Ana está respondiendo…')
  assert.equal(presenceLabel([{ name: 'Ana', state: 'viewing' }]), 'Ana también está viendo este chat')
  assert.equal(presenceLabel([{ name: 'Ana', state: 'viewing' }, { name: 'Luis', state: 'viewing' }]), 'Ana y Luis también están viendo este chat')
  assert.equal(parsePresenceState('typing'), 'typing')
  assert.equal(parsePresenceState('left'), null)
})

test('route: session tenant, chat must belong to it, own rate limit, never an email as name', () => {
  const src = read('src/app/api/chat/conversations/[id]/presence/route.ts')
  assert.match(src, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  assert.match(src, /prisma\.chatConversation\.findFirst\(\{ where: \{ id, tenantId \}/)
  assert.match(src, /identifier: 'chat-presence'/)
  assert.match(src, /staffDisplayName\(/)
  assert.match(src, /presenceStore\.list\(g\.auth\.tenantId, g\.id, g\.auth\.userId\)/)
  assert.doesNotMatch(src, /body\.tenantId|json\?\.tenantId|searchParams\.get\('tenant/)
})
