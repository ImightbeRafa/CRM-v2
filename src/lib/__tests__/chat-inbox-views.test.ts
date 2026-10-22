/**
 * /chats quick views (Rafael 2026-10-18): Persona / Revisar pago / Pedido por confirmar / IA atendiendo /
 * Seguimientos, and follow-ups that never flood the main list. Pure rules + source asserts (no database).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  INBOX_VIEW_DEFS,
  inboxViewRowFromDto,
  matchesInboxView,
  parseInboxView,
  sortForInboxView,
  sumInboxViewCounts,
  waitTone,
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

  it('Revisar pago follows the tag; Pedido is an open order, not the review tag', () => {
    assert.equal(matchesInboxView(row({ tags: [PAYMENT_REVIEW_TAG] }), 'pago'), true)
    assert.equal(matchesInboxView(row({ tags: [ORDER_REVIEW_TAG] }), 'pago'), false)
    assert.equal(matchesInboxView(row({ tags: [ORDER_REVIEW_TAG] }), 'pedido'), false)
    assert.equal(matchesInboxView(row({ hasOpenOrder: true }), 'pedido'), true)
    assert.equal(matchesInboxView(row({ hasOpenOrder: true, tags: [ORDER_REVIEW_TAG] }), 'ia'), false)
    assert.equal(matchesInboxView(row({ hasOpenOrder: true }), 'ia'), true)
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

  it('every view is newest activity first; Seguimientos by the follow-up send (Rafael 2026-10-22)', () => {
    const rows = [
      { id: 'new', lastMessageAt: '2026-10-18T10:05:00Z', lastOutboundAt: '2026-10-18T09:00:00Z' },
      { id: 'answeredOld', lastMessageAt: '2026-10-11T09:00:00Z', lastOutboundAt: '2026-10-19T09:00:00Z' },
      { id: 'old', lastMessageAt: '2026-10-18T08:00:00Z', lastOutboundAt: null },
      { id: 'answeredNew', lastMessageAt: '2026-10-17T09:00:00Z', lastOutboundAt: '2026-10-17T09:00:00Z' },
    ]
    for (const view of ['persona', 'pago', 'pedido', 'ia', 'sin_responder', 'todos'] as const) {
      assert.deepEqual(sortForInboxView(rows, view).map((r) => r.id), ['new', 'old', 'answeredNew', 'answeredOld'], view)
    }
    assert.deepEqual(sortForInboxView(rows, 'seguimientos').map((r) => r.id), ['answeredOld', 'new', 'old', 'answeredNew'])
  })

  it('Sin responder: the customer wrote last, or the agent left it to a person; never in IA', () => {
    const base = { aiMode: null, tags: [], lineAiOn: true, closed: false }
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'inbound' }, 'sin_responder'), true)
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'outbound' }, 'sin_responder'), false)
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'outbound', needsPerson: true }, 'sin_responder'), true)
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'inbound', closed: true }, 'sin_responder'), false)
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'outbound', needsPerson: true }, 'ia'), false)
    assert.equal(matchesInboxView({ ...base, lastMessageDirection: 'outbound' }, 'ia'), true)
    const now = Date.parse('2026-10-22T12:00:00Z')
    assert.equal(waitTone('2026-10-22T11:30:00Z', now), 'fresh')
    assert.equal(waitTone('2026-10-22T10:30:00Z', now), 'warn')
    assert.equal(waitTone('2026-10-22T07:00:00Z', now), 'late')
    assert.equal(waitTone(null, now), 'fresh')
    assert.equal(INBOX_VIEW_DEFS[1].id, 'sin_responder', 'right after Bandeja')
  })

  it('a list row maps to the same view fields (closed from the stage category)', () => {
    const dto = { aiMode: 'human', tags: [PAYMENT_REVIEW_TAG], lastMessageDirection: 'outbound', lastIsFollowUp: true, aiLine: { state: 'on' }, stageCategory: 'open' as const }
    assert.deepEqual(inboxViewRowFromDto(dto), { aiMode: 'human', tags: [PAYMENT_REVIEW_TAG], lastMessageDirection: 'outbound', lastIsFollowUp: true, lineAiOn: true, hasOpenOrder: false, needsPerson: false, closed: false })
    assert.equal(inboxViewRowFromDto({ ...dto, needsPerson: true }).needsPerson, true)
    assert.equal(inboxViewRowFromDto({ ...dto, hasOpenOrder: true }).hasOpenOrder, true)
    assert.equal(inboxViewRowFromDto({ ...dto, stageCategory: 'won' }).closed, true)
    assert.equal(inboxViewRowFromDto({ ...dto, aiLine: null }).lineAiOn, false)
  })

  it('counts follow the channel / line filter; unknown stored tab falls back to Todos', () => {
    const byAccount = { wa: { persona: 2, pago: 1 }, ig: { persona: 1, seguimientos: 4 } }
    assert.deepEqual(sumInboxViewCounts(byAccount, null), { sin_responder: 0, persona: 3, pago: 1, pedido: 0, ia: 0, seguimientos: 4 })
    assert.deepEqual(sumInboxViewCounts(byAccount, ['ig']), { sin_responder: 0, persona: 1, pago: 0, pedido: 0, ia: 0, seguimientos: 4 })
    assert.deepEqual(sumInboxViewCounts({ wa: { sin_responder: 3 }, ig: { sin_responder: 2 } }, ['wa']).sin_responder, 3)
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
    assert.equal((server.match(/WHERE c\."tenantId" = \$\{tenantId\}/g) || []).length, 4)
    assert.match(server, /m\."tenantId" = c\."tenantId"/)
    assert.match(server, /GROUP BY c\."socialAccountId"/)
    // SecureDog: the last message row itself must be ours; counts cached 15 s per tenant with one shared query.
    assert.equal((server.match(/AND m\.direction = 'outbound'/g) || []).length, 3)
    assert.match(server, /COUNTS_TTL_MS = 15_000/)
    assert.match(server, /if \(hit && Date\.now\(\) - hit\.at < COUNTS_TTL_MS\) return hit\.value/)
    // Database errors never reach the client from the list route.
    const list = read('src/app/api/chat/conversations/route.ts')
    assert.match(list, /\/\^Invalid \[A-Za-z\]\+\$\/\.test\(message\)/)
    assert.match(list, /error: status === 400 \? message : 'list_failed'/)
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
    // Verifier: the view request follows the line / channel; the full refresh keeps rows of the open view; PATCH keeps the flag.
    assert.match(inbox, /new URLSearchParams\(\{ view: inboxView, limit: '100' \}\)/)
    assert.match(inbox, /qs\.set\('socialAccountId', accountFilter\)/)
    assert.match(inbox, /if \(matchesInboxView\(inboxViewRowFromDto\(d\), view\)\) keep\.push\(d\)/)
    assert.match(inbox, /lastIsFollowUp: incoming\.lastIsFollowUp \?\? before\.lastIsFollowUp/)
    assert.match(inbox, /if \(viewCountsBusyRef\.current\) return/)
  })
})

describe('Sin responder · server wiring (Lane A 2026-10-22)', () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')
  it('one SQL rule feeds the list, the counts and the row flag; IA count excludes it; newest first', () => {
    const rule = read('src/lib/chat-unanswered-server.ts')
    const has = (src: string, text: string) => assert.ok(src.includes(text), text)
    has(rule, "lt.om ->> 'needsHuman' = 'true'")
    has(rule, "lt.om ->> 'fallbackUsed' = 'true'")
    has(rule, "lt.om ->> 'handoffKind' IN ('handoff', 'review')")
    has(rule, "COALESCE(hm.metadata ->> 'softAi', '') <> 'true'")
    has(rule, 'WHERE t."conversationId" = c.id AND t."tenantId" = c."tenantId"')
    const views = read('src/lib/chat-inbox-views-server.ts')
    has(views, 'COUNT(*) FILTER (WHERE ${UNANSWERED_SQL}) AS sin_responder')
    assert.match(views, /AND NOT \$\{NEEDS_PERSON_SQL\}\r?\n\s*\) AS ia/)
    const route = read('src/app/api/chat/conversations/route.ts')
    has(route, 'listUnansweredIds(auth.tenantId, viewClosedKeys, limit)')
    has(route, 'attachNeedsPersonFlag(auth.tenantId, base)')
    assert.ok(!route.includes("lastInboundAt: { sort: 'asc'"))
    has(read('src/app/api/chat/conversations/changes/route.ts'), 'attachNeedsPersonFlag(auth.tenantId')
  })
})
