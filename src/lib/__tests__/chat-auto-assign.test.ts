import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { autoAssignOnFirstHumanReply } from '@/lib/chat-auto-assign'

function fakeDb(count: number) {
  const calls: unknown[] = []
  return {
    calls,
    db: { chatConversation: { updateMany: async (args: unknown) => (calls.push(args), { count }) } },
  }
}

test('assigns only an unassigned chat, tenant-scoped', async () => {
  const { db, calls } = fakeDb(1)
  const ok = await autoAssignOnFirstHumanReply(db, { tenantId: 't1', conversationId: 'c1', userId: 'u1' }, async () => true)
  assert.equal(ok, true)
  assert.deepEqual(calls[0], {
    where: { id: 'c1', tenantId: 't1', assignedUserId: null },
    data: { assignedUserId: 'u1' },
  })
})

test('never assigns non-members and never throws', async () => {
  const { db, calls } = fakeDb(1)
  assert.equal(await autoAssignOnFirstHumanReply(db, { tenantId: 't1', conversationId: 'c1', userId: 'x' }, async () => false), false)
  assert.equal(calls.length, 0)
  const boom = { chatConversation: { updateMany: async () => { throw new Error('db down') } } }
  assert.equal(await autoAssignOnFirstHumanReply(boom, { tenantId: 't', conversationId: 'c', userId: 'u' }, async () => true), false)
})

test('send route auto-assigns only after a delivered human send', () => {
  const src = readFileSync('src/app/api/chat/send/route.ts', 'utf8')
  assert.match(src, /if \(providerMessageId && write\.conversationId && senderUser\) \{\s*await autoAssignOnFirstHumanReply/)
})
