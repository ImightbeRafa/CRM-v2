import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { safeAdHref } from '../../components/chats/ChatAdOriginCard'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

test('attribution API is tenant-scoped, read-only and never returns the click id', () => {
  const route = read('src/app/api/chat/conversations/[id]/attribution/route.ts')
  assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
  assert.match(route, /where: \{ id, tenantId: auth\.tenantId \}/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  const reader = read('src/lib/meta-attribution/read.ts')
  assert.match(reader, /const where = \{ tenantId, conversationId \}/)
  assert.doesNotMatch(reader, /ctwaClid/)
  assert.match(reader, /if \(isMissingTable\(error\)\) return null/)
})

test('ad card only links to https and opens it safely', () => {
  assert.equal(safeAdHref('https://fb.me/abc'), 'https://fb.me/abc')
  assert.equal(safeAdHref('javascript:alert(1)'), null)
  assert.equal(safeAdHref('http://fb.me/abc'), null)
  assert.equal(safeAdHref('https://evil.example/login'), null, 'non-Meta host')
  assert.equal(safeAdHref('https://www.facebook.com@evil.example/'), null)
  assert.equal(safeAdHref(null), null)
  const card = read('src/components/chats/ChatAdOriginCard.tsx')
  assert.match(card, /rel="noopener noreferrer"/)
  assert.doesNotMatch(card, /dangerouslySetInnerHTML/)
})

test('the card sits above the client panel in the V2 inbox (separate request, not in the list query)', () => {
  const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
  assert.match(inbox, /<ChatAdOriginCard key=\{`ad-\$\{selectedConversationId\}`\} conversationId=\{selectedConversationId\} \/>/)
  assert.doesNotMatch(read('src/app/api/chat/conversations/route.ts'), /chatAdReferral|ChatAdReferral/)
})
