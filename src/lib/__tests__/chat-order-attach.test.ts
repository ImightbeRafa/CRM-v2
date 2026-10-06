import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseOrderSearch, phoneTail, phoneTails, rankAttachCandidates, searchPhoneDigits } from '@/lib/chat-order-attach'

const read = (p: string) => readFileSync(p, 'utf8')
const ROUTE = 'src/app/api/chat/conversations/[id]/orders/route.ts'

test('phoneTail: Costa Rica numbers whatever the format; other countries and short numbers never match', () => {
  assert.equal(phoneTail('50688148939'), '88148939')
  assert.equal(phoneTail('+506 8814-8939'), '88148939')
  assert.equal(phoneTail('8814-8939'), '88148939')
  assert.equal(phoneTail('1234567'), null)
  // Nicaragua / Panamá also have 8-digit numbers: a +505 chat must not match a CR order.
  assert.equal(phoneTail('50588148939'), null)
  assert.equal(phoneTail('+507 8814 8939'), null)
  assert.equal(searchPhoneDigits('50688148939'), '88148939')
  assert.equal(searchPhoneDigits('8148'), '8148')
  assert.equal(phoneTail(null), null)
  assert.deepEqual(phoneTails(['50688148939', '8814-8939', null, '']), ['88148939'])
})

test('parseOrderSearch: strips #, needs 2 chars, phone digits from 4', () => {
  assert.deepEqual(parseOrderSearch(''), { kind: 'none' })
  assert.deepEqual(parseOrderSearch('#'), { kind: 'none' })
  assert.deepEqual(parseOrderSearch('#ORD-1791'), { kind: 'text', text: 'ORD-1791', digits: '1791' })
  assert.deepEqual(parseOrderSearch('isidro'), { kind: 'text', text: 'isidro', digits: null })
  assert.equal(parseOrderSearch('x'.repeat(200)).kind === 'text' && (parseOrderSearch('x'.repeat(200)) as { text: string }).text.length, 60)
})

test('ranking: same phone, then same name, then recent; newest first inside a group', () => {
  const at = (d: string) => new Date(d)
  const ranked = rankAttachCandidates(
    [
      { id: 'r', orderId: 'ORD-4', timestamp: at('2026-10-05'), phone: '8888-0000', customerName: 'Haylen Castillo' },
      { id: 'n', orderId: 'ORD-3', timestamp: at('2026-10-04'), phone: null, customerName: 'Isidro Con Matarrita' },
      { id: 'p-old', orderId: 'ORD-2', timestamp: at('2026-07-25'), phone: '88148939', customerName: 'Isidro' },
      { id: 'p-new', orderId: 'ORD-1', timestamp: at('2026-10-05'), phone: '8814-8939', customerName: 'Isidro Con Con Matarrita' },
    ],
    { tails: ['88148939'], names: ['Isidro'], searching: false },
  )
  assert.deepEqual(
    ranked.map((o) => [o.id, o.match]),
    [
      ['p-new', 'phone'],
      ['p-old', 'phone'],
      ['n', 'name'],
      ['r', 'recent'],
    ],
  )
})

test('ranking: same first name but different surnames is not a name match', () => {
  const ranked = rankAttachCandidates(
    [{ id: 'a', orderId: 'X-1', timestamp: new Date(), phone: null, customerName: 'Ana Mora' }],
    { tails: [], names: ['Ana Solís'], searching: true },
  )
  assert.equal(ranked[0].match, 'search', 'first name alone with different surnames is not a name match')
})

test('ranking: exact order number first; "recent" only for rows from the recent query', () => {
  const at = (d: string) => new Date(d)
  const ranked = rankAttachCandidates(
    [
      { id: 'b', orderId: 'ORD-17910', timestamp: at('2026-10-05'), phone: null, customerName: 'B' },
      { id: 'a', orderId: 'ORD-1791', timestamp: at('2026-01-01'), phone: null, customerName: 'A' },
    ],
    { tails: [], names: [], searching: true, query: '1791' },
  )
  assert.equal(ranked[0].id, 'a')
  const suggested = rankAttachCandidates(
    [
      { id: 'mine', orderId: 'O-1', timestamp: at('2026-10-05'), phone: null, customerName: 'Anabel Rojas' },
      { id: 'rec', orderId: 'O-2', timestamp: at('2026-10-04'), phone: null, customerName: 'Luis' },
    ],
    { tails: [], names: ['Ana'], searching: false, recentIds: new Set(['rec']) },
  )
  assert.deepEqual(
    suggested.map((o) => [o.id, o.match]),
    [
      ['mine', 'search'],
      ['rec', 'recent'],
    ],
  )
})

test('detach expires pending Meta purchases for that chat; web orders keep their Web channel', () => {
  const src = read(ROUTE)
  assert.match(src, /UPDATE public\."MetaConversionEvent" SET "status" = 'expired'/)
  assert.match(src, /"tenantId" = \$\{tenantId\} AND "orderId" = \$\{orderId\} AND "conversationId" = \$\{conversation\.id\}/)
})

test('orders route: update_sales, same-origin writes, tenant-scoped, conditional write, audit', () => {
  const src = read(ROUTE)
  assert.equal((src.match(/authenticateAPIWithPermission\(request, 'update_sales'\)/g) || []).length, 3)
  assert.equal((src.match(/if \(!isSameOriginJson\(request\)\)/g) || []).length, 2)
  assert.equal((src.match(/workspaceWriteRateLimit\(/g) || []).length, 2)
  assert.match(src, /chatConversation\.findFirst\(\{\s*where: \{ id, tenantId \}/)
  assert.match(src, /order\.findFirst\(\{\s*where: \{ id: orderId, tenantId, deletedAt: null \}/)
  // Never overwrites another order's link.
  assert.match(src, /updateMany\(\{\s*where: \{ id: target\.id, tenantId, orderId: null \}/)
  // Unlink only touches this chat's messages.
  assert.match(src, /where: \{ tenantId, conversationId: conversation\.id, orderId \},\s*data: \{ orderId: null \}/)
  assert.match(src, /code: 'phone_mismatch'/)
  assert.equal((src.match(/logAuditEvent\(/g) || []).length, 2)
  assert.match(src, /verb: 'chat\.order\.link'/)
  assert.match(src, /verb: 'chat\.order\.unlink'/)
  // Revision bump so open inboxes refresh.
  assert.equal((src.match(/chatConversation\s*\r?\n?\s*\.updateMany\(\{ where: \{ id: conversation\.id, tenantId \}/g) || []).length, 2)
})

test('phone SQL is tenant-scoped, skips archived orders and is parameterised', () => {
  const src = read('src/lib/chat-order-attach-server.ts')
  assert.equal((src.match(/o\."tenantId" = \$\{tenantId\}/g) || []).length, 2)
  assert.equal((src.match(/o\."deletedAt" IS NULL/g) || []).length, 2)
  assert.doesNotMatch(src, /\$queryRawUnsafe|\$executeRawUnsafe/)
  assert.match(src, /'\\\\D'/, "regex escape must reach SQL as '\\D'")
})

test('Cliente panel lists same-phone orders (web orders have no clientId) and marks the linked ones', () => {
  const src = read('src/app/api/chat/conversations/[id]/client/route.ts')
  assert.match(src, /orderIdsByPhoneTails\(tenantId, tails/)
  assert.match(src, /linked: linkedSet\.has\(o\.id\)/)
  const panel = read('src/components/chats/ChatClientPanel.tsx')
  assert.match(panel, /Vincular pedido/)
  assert.match(panel, /<OrderAttachPicker/)
  assert.match(panel, /Quitar del chat/)
  assert.match(panel, /code === 'phone_mismatch'/)
})
