/** Phase 2a activity log (2026-09-29): safe payloads, never blocks, wired into human actions. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isValidVerb, sanitizeActivityProps } from '../activity'
import { isMissingRelation } from '../db-missing-relation'

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\r\n/g, '\n')

test('verbs are short dotted lowercase names (same rule as the DB check)', () => {
  for (const v of ['chat.stage.set', 'guia.generate', 'chat.client.link']) assert.equal(isValidVerb(v), true, v)
  for (const v of ['', 'x', 'Chat.Stage', 'drop table;', 'a'.repeat(65)]) assert.equal(isValidVerb(v), false, v)
})

test('props keep only short scalars (no message bodies / objects)', () => {
  const out = sanitizeActivityProps({
    from: 'nuevo',
    to: 'x'.repeat(500),
    n: 3,
    ok: true,
    nothing: null,
    nested: { a: 1 } as never,
    'bad key!': 'x',
    inf: Infinity,
  })
  assert.deepEqual(Object.keys(out).sort(), ['from', 'n', 'nothing', 'ok', 'to'])
  assert.equal((out.to as string).length, 80)
})

test('missing table (035 not applied) is recognized, other errors are not', () => {
  assert.equal(isMissingRelation({ code: '42P01' }), true)
  assert.equal(isMissingRelation({ code: 'P2010', meta: { code: '42P01' } }), true)
  assert.equal(isMissingRelation({ code: 'P2002' }), false)
})

test('recordActivity never throws or blocks and tolerates the missing table', () => {
  const src = read('src/lib/activity.ts')
  assert.match(src, /if \(isMissingRelation\(error\)\) \{\s*tableMissingUntil/)
  assert.match(src, /if \(code === 'P2002'\) return/)
})

test('human actions are recorded (fire-and-forget)', () => {
  const patch = read('src/app/api/chat/conversations/[id]/route.ts')
  for (const verb of ['chat.stage.set', 'chat.tags.set', 'chat.assign', 'chat.ai_mode.set']) {
    assert.ok(patch.includes("void recordActivity({ ...base, verb: '" + verb + "'"), verb)
  }
  assert.ok(patch.includes("description: 'Modo de IA del chat cambiado'"), 'aiMode changes also audited')
  assert.ok(read('src/app/api/chat/conversations/[id]/client/route.ts').includes("verb: clientId ? 'chat.client.link' : 'chat.client.unlink'"))
  // send-guia logic moved to the shared service (Chats button + automatic guía)
  assert.ok(read('src/lib/shipping/send-guia-to-chat.ts').includes("verb: 'guia.send_chat'"))
  assert.ok(read('src/app/api/shipping/generate-guia/route.ts').includes("verb: 'guia.generate'"))
})

test('no message text or phone numbers go into activity props', () => {
  const banned = ['.phone', 'peerId', 'normalizedPhone', 'body.text', '.text', 'caption', 'customerName', 'peerName']
  for (const f of ['src/app/api/chat/conversations/[id]/route.ts', 'src/lib/shipping/send-guia-to-chat.ts', 'src/app/api/chat/conversations/[id]/client/route.ts', 'src/app/api/shipping/generate-guia/route.ts']) {
    const calls = read(f).split('recordActivity(').slice(1).map((c) => c.split('})')[0])
    for (const c of calls) for (const b of banned) assert.ok(!c.includes(b), f + ': ' + b)
  }
})
