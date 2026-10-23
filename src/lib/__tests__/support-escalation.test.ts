/**
 * Betsy's own agent escalations → Betsy's support pipeline (opt-in, allowlisted, idempotent per chat, masked).
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/support-escalation.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildSupportTicketBody,
  escalateHandoffFromJob,
  escalateHandoffToSupport,
  maskForSupport,
  supportCategoryFor,
  supportChatTenants,
} from '@/lib/soft-ai/support-escalation'
import { EMPTY_SALES_RULES, parseSalesRules } from '@/lib/soft-ai/agent-sales-setup'

const read = (p: string) => readFileSync(p, 'utf8')

describe('support escalation: gates', () => {
  it('the setting is off by default and only `true` turns it on', () => {
    assert.equal(EMPTY_SALES_RULES.escalateToSupport, false)
    assert.equal(parseSalesRules({}).escalateToSupport, false)
    assert.equal(parseSalesRules({ escalateToSupport: 'true' }).escalateToSupport, false)
    assert.equal(parseSalesRules({ escalateToSupport: true }).escalateToSupport, true)
  })
  it('nothing happens with the pipeline off or a business not allowlisted (no DB access)', async () => {
    const row = { tenantId: 't-1', conversationId: 'c-1', socialAccountId: 's-1', deliveryKey: 'k-1' }
    assert.equal(await escalateHandoffFromJob(row, 'escalate', { SUPPORT_PIPELINE_ENABLED: 'false', SUPPORT_AI_CHAT_TENANTS: 't-1' }), 'skipped')
    assert.equal(await escalateHandoffFromJob(row, 'escalate', { SUPPORT_PIPELINE_ENABLED: 'true', SUPPORT_AI_CHAT_TENANTS: 't-2' }), 'skipped')
    assert.equal(await escalateHandoffFromJob(row, 'escalate', { SUPPORT_PIPELINE_ENABLED: 'true' }), 'skipped')
    assert.equal(await escalateHandoffToSupport({ tenantId: 't-1', conversationId: 'c-1', agentId: null, reason: 'escalate' }, { SUPPORT_PIPELINE_ENABLED: 'true', SUPPORT_AI_CHAT_TENANTS: 't-1' }), 'skipped')
    assert.deepEqual([...supportChatTenants({ SUPPORT_AI_CHAT_TENANTS: ' a, ,b ' })], ['a', 'b'])
  })
})

describe('support escalation: what leaves the inbox', () => {
  it('masks secrets, cards, e-mails, SINPE / phone numbers and IBANs', () => {
    const t = maskForSupport('Mi SINPE es 8888-1234, tarjeta 4111 1111 1111 1111, correo ana@x.com, IBAN CR05 0152 0200 1026 2840 66, token=abc123secret')
    assert.doesNotMatch(t, /8888|4111|ana@x\.com|CR05|abc123secret/)
    assert.match(t, /\[número\]|\[REDACTED_CARD\]/)
  })
  it('the body: channel, reason, chat link, the last 6 messages (masked)', () => {
    const body = buildSupportTicketBody({
      channel: 'Instagram',
      handle: '@cliente',
      reasonLabel: 'Necesita una persona',
      chatUrl: 'https://www.betsycrm.com/chats?c=c-1',
      messages: Array.from({ length: 9 }, (_, i) => ({ direction: i % 2 ? 'outbound' : 'inbound', content: `mensaje ${i} 8888-${1000 + i}` })),
    })
    assert.match(body, /^Chat de Instagram \(@cliente\)\nMotivo: Necesita una persona\nAbrir el chat: https:\/\/www\.betsycrm\.com\/chats\?c=c-1/)
    assert.equal((body.match(/^(Cliente|Betsy): /gm) || []).length, 6)
    assert.doesNotMatch(body, /8888-/)
  })
  it('custom-agent questions go to agent_request, the rest to question', () => {
    assert.equal(supportCategoryFor('Quiero un agente de IA para mi tienda'), 'agent_request')
    assert.equal(supportCategoryFor('¿Cómo conecto mi Instagram?'), 'question')
  })
})

describe('support escalation: wiring (source)', () => {
  const src = read('src/lib/soft-ai/support-escalation.ts')
  it('one open ticket per chat; a later hand-off is an internal note', () => {
    assert.ok(src.includes("where: { source: 'ai_chat', status: { in: [...OPEN_STATUSES] }, meta: { path: ['conversationId'], equals: conversation.id } },"))
    assert.ok(src.includes("await addStaffMessage({ ticketId: open.id, author: 'system', visibility: 'internal', body:"))
  })
  it('the chat customer is never e-mailed (contact = Betsy support inbox), no tenant / user on the ticket', () => {
    assert.ok(src.includes('email: getSupportEmailConfig(env).agentInbox'))
    assert.ok(src.includes('tenantId: null,'))
    assert.ok(src.includes('userId: null,'))
    assert.ok(src.includes("source: 'ai_chat',"))
  })
  it('true hand-offs only, after the normal inbox hand-off; the env name reaches the container', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const fn = turn.slice(turn.indexOf('async function settleHandoff('), turn.indexOf('/** Delivery decision + "La IA no respondió"'))
    assert.ok(fn.indexOf('await notifyHandoff(') < fn.indexOf("if (handoff.kind === 'handoff') void escalateHandoffFromJob(row, handoff.reason)"))
    const w = read('src/cf-container-worker.ts')
    assert.ok(w.includes('SUPPORT_AI_CHAT_TENANTS?: string;') && w.includes('"SUPPORT_AI_CHAT_TENANTS",'))
  })
})
