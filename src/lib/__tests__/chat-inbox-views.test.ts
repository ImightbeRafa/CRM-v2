/**
 * /chats quick views (Rafael 2026-10-18): Persona / Revisar pago / Pedido por confirmar / IA atendiendo /
 * Seguimientos, and follow-ups that never flood the main list. Pure rules + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  matchesInboxView,
  parseInboxView,
  sortForInboxView,
  sumInboxViewCounts,
  type InboxViewRow,
} from '@/lib/chat-inbox-views'
import { parseConversationListQuery, conversationListCursorScope } from '@/lib/chat-conversation-query'
import { ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG } from '@/lib/crm-stages'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
const row = (over: Partial<InboxViewRow> = {}): InboxViewRow => ({
  aiMode: null,
  tags: [],
  lastMessageDirection: 'inbound',
  lastIsFollowUp: false,
  lineAiOn: true,
  closed: false,
  ...over,
})

describe('chat views · rules', () => {
  it('Persona = a person has the chat (hand-off sets human; paused / legacy takeover too)', () => {
    for (const aiMode of ['human', 'paused', 'human_takeover']) assert.equal(matchesInboxView(row({ aiMode }), 'persona'), true)
    for (const aiMode of [null, 'ai_active']) assert.equal(matchesInboxView(row({ aiMode }), 'persona'), false)
  })

  it('Revisar pago / Pedido por confirmar follow the built-in tags', () => {
    assert.equal(matchesInboxView(row({ tags: [PAYMENT_REVIEW_TAG] }), 'pago'), true)
    assert.equal(matchesInboxView(row({ tags: [ORDER_REVIEW_TAG] }), 'pago'), false)
    assert.equal(matchesInboxView(row({ tags: [ORDER_REVIEW_TAG] }), 'pedido'), true)
  })

  it('IA atendiendo = line on, nobody took it, nothing waiting for review', () => {
    assert.equal(matchesInboxView(row(), 'ia'), true)
    assert.equal(matchesInboxView(row({ lineAiOn: false }), 'ia'), false)
    assert.equal(matchesInboxView(row({ aiMode: 'human' }), 'ia'), false)
    assert.equal(matchesInboxView(row({ tags: [PAYMENT_REVIEW_TAG] }), 'ia'), false)
  })

  it('Seguimientos = our follow-up is the last message; the customer answering takes it out', () => {
    assert.equal(matchesInboxView(row({ lastMessageDirection: 'outbound', lastIsFollowUp: true }), 'seguimientos'), true)
    assert.equal(matchesInboxView(row({ lastMessageDirection: 'outbound', lastIsFollowUp: false }), 'seguimientos'), false)
    assert.equal(matchesInboxView(row({ lastMessageDirection: 'inbound', lastIsFollowUp: true }), 'seguimientos'), false)
  })

  it('closed chats are in no view; Todos shows everything', () => {
    for (const v of ['persona', 'pago', 'pedido', 'ia', 'seguimientos'] as const) {
      assert.equal(matchesInboxView(row({ closed: true, aiMode: 'human', tags: [PAYMENT_REVIEW_TAG, ORDER_REVIEW_TAG], lastMessageDirection: 'outbound', lastIsFollowUp: true }), v), false)
    }
    assert.equal(matchesInboxView(row({ closed: true }), 'todos'), true)
  })

  it('Persona sorts who waits longest first; other views keep the list order', () => {
    const rows = [
      { id: 'new', lastInboundAt: '2026-10-18T10:00:00Z', lastMessageAt: '2026-10-18T10:05:00Z' },
      { id: 'old', lastInboundAt: '2026-10-18T08:00:00Z', lastMessageAt: '2026-10-18T11:00:00Z' },
      { id: 'none', lastInboundAt: null, lastMessageAt: '2026-10-18T09:00:00Z' },
    ]
    assert.deepEqual(sortForInboxView(rows, 'persona').map((r) => r.id), ['old', 'none', 'new'])
    assert.deepEqual(sortForInboxView(rows, 'pago').map((r) => r.id), ['new', 'old', 'none'])
  })

  it('counts follow the channel / line filter; unknown stored tab falls back to Todos', () => {
    const byAccount = { wa: { persona: 2, pago: 1 }, ig: { persona: 1, seguimientos: 4 } }
    assert.deepEqual(sumInboxViewCounts(byAccount, null), { persona: 3, pago: 1, pedido: 0, ia: 0, seguimientos: 4 })
    assert.deepEqual(sumInboxViewCounts(byAccount, ['ig']), { persona: 1, pago: 0, pedido: 0, ia: 0, seguimientos: 4 })
    assert.equal(parseInboxView('pago'), 'pago')
    assert.equal(parseInboxView('<script>'), 'todos')
    assert.equal(parseInboxView(null), 'todos')
  })
})

describe('chat views · server', () => {
  it('the list accepts only known views and keeps old cursors valid', () => {
    assert.equal(parseConversationListQuery(new URLSearchParams('view=persona')).view, 'persona')
    assert.equal(parseConversationListQuery(new URLSearchParams('')).view, null)
    assert.throws(() => parseConversationListQuery(new URLSearchParams('view=all')), /Invalid view/)
    const plain = parseConversationListQuery(new URLSearchParams(''))
    // Same scope hash as before the change (no `view` key when unset).
    assert.equal(conversationListCursorScope('t1', plain), conversationListCursorScope('t1', { ...plain, view: undefined }))
    assert.notEqual(conversationListCursorScope('t1', plain), conversationListCursorScope('t1', { ...plain, view: 'pago' }))
  })

  it('counts and flags are tenant-scoped SQL; the counts route needs the inbox permission', () => {
    const server = read('src/lib/chat-inbox-views-server.ts')
    assert.equal((server.match(/WHERE c\."tenantId" = \$\{tenantId\}/g) || []).length, 3)
    assert.match(server, /m\."tenantId" = c\."tenantId"/)
    assert.match(server, /GROUP BY c\."socialAccountId"/)
    const route = read('src/app/api/chat/conversations/view-counts/route.ts')
    assert.match(route, /authenticateAPIWithPermission\(request, 'update_sales'\)/)
    assert.match(route, /loadInboxViewCounts\(auth\.tenantId/)
  })

  it('a follow-up send keeps the chat in place and list / changes rows carry the follow-up flag', () => {
    assert.match(read('src/lib/soft-ai/follow-up.ts'), /keepListPosition: true,/)
    assert.match(read('src/app/api/chat/conversations/route.ts'), /attachFollowUpFlag\(auth\.tenantId, base\)/)
    assert.match(read('src/app/api/chat/conversations/changes/route.ts'), /attachFollowUpFlag\(auth\.tenantId,/)
  })

  it('the inbox remembers the tab per user and refreshes counts at most every 20 s', () => {
    const inbox = read('src/components/chats/SoftCopilotInboxV2.tsx')
    assert.match(inbox, /INBOX_VIEW_STORAGE_KEY\}:\$\{/)
    assert.match(inbox, /viewCountsAtRef\.current \+ 20_000/)
    assert.match(inbox, /pinRows\(`view=\$\{inboxView\}&limit=100`\)/)
  })
})
