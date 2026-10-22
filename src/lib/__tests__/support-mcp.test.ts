import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { checkMcpBearer } from '../support/mcp/auth'
import { MCP_PROTOCOL_VERSION, RPC, ToolError, handleMcpMessage, type McpTool } from '../support/mcp/protocol'
import { decidePublicReply, externalLinks, parseAutosendMode } from '../support/mcp/reply-policy'

// tools.ts pulls in auth modules that build a Resend client at import time.
process.env.RESEND_API_KEY ||= 're_test_placeholder'
const { supportMcpTools } = await import('../support/mcp/tools')

type AuditRow = { tool: string; ticketId: string | null; ok: boolean; error: string | null }

function ctx(tools: McpTool[]) {
  const rows: AuditRow[] = []
  return { rows, ctx: { tools, audit: async (r: AuditRow) => void rows.push(r) } }
}

const echo: McpTool = {
  name: 'echo',
  description: 'test',
  inputSchema: { type: 'object' },
  args: z.object({ text: z.string() }).strict(),
  handler: async (a: { text: string }) => ({ result: { text: a.text }, ticketId: 't1' }),
}
const failing: McpTool = {
  name: 'fails',
  description: 'test',
  inputSchema: { type: 'object' },
  args: z.object({}).strict(),
  handler: async () => {
    throw new ToolError('Ticket no encontrado.')
  },
}
const crashing: McpTool = { ...failing, name: 'crash', handler: async () => { throw new Error('db password=secret') } }

test('tools/list exposes exactly the 8 spec tools', () => {
  const names = supportMcpTools().map((t) => t.name).sort()
  assert.deepEqual(names, [
    'agents_get_access',
    'support_escalate',
    'support_get_tenant_context',
    'support_get_ticket',
    'support_list_tickets',
    'support_reply',
    'support_search_kb',
    'support_update_ticket',
  ])
  for (const t of supportMcpTools()) {
    assert.equal((t.inputSchema as { type?: string }).type, 'object', t.name)
    assert.equal((t.inputSchema as { additionalProperties?: boolean }).additionalProperties, false, t.name)
  }
})

test('no tool can enable agents, delete tickets or read orders/clients', () => {
  const names = supportMcpTools().map((t) => t.name).join(' ')
  assert.doesNotMatch(names, /enable|delete|order|client|set_access/)
})

test('initialize negotiates the protocol version', async () => {
  const { ctx: c } = ctx([])
  const r = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, c)) as any
  assert.equal(r.result.protocolVersion, '2025-03-26')
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } })
  const r2 = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999' } }, c)) as any
  assert.equal(r2.result.protocolVersion, MCP_PROTOCOL_VERSION)
})

test('ping, notifications, batches, invalid and unknown methods', async () => {
  const { ctx: c } = ctx([])
  assert.deepEqual(await handleMcpMessage({ jsonrpc: '2.0', id: 'a', method: 'ping' }, c), { jsonrpc: '2.0', id: 'a', result: {} })
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, c), null)
  assert.equal(((await handleMcpMessage([{ jsonrpc: '2.0', id: 1, method: 'ping' }], c)) as any).error.code, RPC.INVALID_REQUEST)
  assert.equal(((await handleMcpMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }, c)) as any).error.code, RPC.INVALID_REQUEST)
  assert.equal(((await handleMcpMessage({ jsonrpc: '2.0', id: {}, method: 'ping' }, c)) as any).error.code, RPC.INVALID_REQUEST)
  assert.equal(((await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'resources/list' }, c)) as any).error.code, RPC.METHOD_NOT_FOUND)
})

test('tools/call: success, unknown tool, invalid args, tool error, crash — each audited', async () => {
  const { rows, ctx: c } = ctx([echo, failing, crashing])
  const ok = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hola' } } }, c)) as any
  assert.deepEqual(ok.result.structuredContent, { text: 'hola' })
  assert.equal(ok.result.content[0].type, 'text')
  const unknown = (await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope' } }, c)) as any
  assert.equal(unknown.error.code, RPC.INVALID_PARAMS)
  const invalid = (await handleMcpMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 1, extra: true } } }, c)) as any
  assert.equal(invalid.error.code, RPC.INVALID_PARAMS)
  const failed = (await handleMcpMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fails' } }, c)) as any
  assert.equal(failed.result.isError, true)
  assert.equal(failed.result.content[0].text, 'Ticket no encontrado.')
  const crashed = (await handleMcpMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'crash' } }, c)) as any
  assert.equal(crashed.result.isError, true)
  assert.equal(crashed.result.content[0].text, 'Internal error', 'internal error details never reach the agent')
  assert.deepEqual(rows, [
    { tool: 'echo', ticketId: 't1', ok: true, error: null },
    { tool: 'nope', ticketId: null, ok: false, error: 'unknown_tool' },
    { tool: 'echo', ticketId: null, ok: false, error: 'invalid_arguments' },
    { tool: 'fails', ticketId: null, ok: false, error: 'Ticket no encontrado.' },
    { tool: 'crash', ticketId: null, ok: false, error: 'Internal error' },
  ])
})

test('MCP bearer: unset/short token → 503, wrong/missing → 401, right → ok', () => {
  const token = 'x'.repeat(40)
  assert.deepEqual(checkMcpBearer(`Bearer ${token}`, undefined), { ok: false, status: 503 })
  assert.deepEqual(checkMcpBearer('Bearer short', 'short'), { ok: false, status: 503 })
  assert.deepEqual(checkMcpBearer(null, token), { ok: false, status: 401 })
  assert.deepEqual(checkMcpBearer('Basic abc', token), { ok: false, status: 401 })
  assert.deepEqual(checkMcpBearer(`Bearer ${token}x`, token), { ok: false, status: 401 })
  assert.deepEqual(checkMcpBearer('Bearer a', token), { ok: false, status: 401 })
  assert.deepEqual(checkMcpBearer(`Bearer ${token}`, token), { ok: true })
  assert.deepEqual(checkMcpBearer(`bearer ${token}`, ` ${token} `), { ok: true })
})

const OWN = { whatsappDigits: '50662470831', instagramHandle: 'betsy_crm' }

test('reply policy: auto-send is OFF by default and anonymous tickets stay drafts in signed_in mode', () => {
  const base = { status: 'open', category: 'question', assignee: 'grok_agent', body: 'Hola, así se hace.', draftCategories: new Set(['billing']) }
  assert.equal(decidePublicReply(base).action, 'draft')
  assert.equal(decidePublicReply({ ...base, autosend: 'signed_in', signedIn: false }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, autosend: 'signed_in', signedIn: true }).action, 'send')
  assert.equal(decidePublicReply({ ...base, autosend: 'all', signedIn: false }).action, 'send')
})

test('reply policy (auto-send on): categories, escalation, spam and sensitive content', () => {
  const base = {
    status: 'open',
    category: 'question',
    assignee: 'grok_agent',
    body: 'Hola, así se hace.',
    draftCategories: new Set(['billing', 'agent_request']),
    autosend: 'all' as const,
    signedIn: true,
    ref: 'BETSY-10',
    own: OWN,
  }
  assert.deepEqual(decidePublicReply(base), { action: 'send' })
  assert.equal(decidePublicReply({ ...base, status: 'spam' }).action, 'refuse')
  assert.equal(decidePublicReply({ ...base, category: 'billing' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, category: 'agent_request' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, status: 'escalated' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, assignee: 'rafael' }).action, 'draft')
  const held = [
    'Entrá a https://evil.example/login',
    'Ingresá a evil.co/login ya',
    'Pagá en pagos-betsy.com hoy',
    'Escribile a betsy-soporte.site',
    'Escribinos a https://wa.me/50688888888',
    'Seguinos en https://www.instagram.com/betsy_crm_pagos/',
    'Tu correo es otra@persona.com',
    'Llamá al +506 8888-8888',
    'Cuenta IBAN 1234567890123',
    'Lo mismo pasó en BETSY-11',
  ]
  for (const body of held) assert.equal(decidePublicReply({ ...base, body }).action, 'draft', body)
  const allowed = [
    'Guía: https://www.betsycrm.com/help/billing',
    'WhatsApp: https://wa.me/50662470831 o +506 6247-0831',
    'Instagram: https://www.instagram.com/betsy_crm/',
    'Tu caso BETSY-10 está listo.',
    'Hacelo en 3 pasos y listo.',
  ]
  for (const body of allowed) assert.equal(decidePublicReply({ ...base, body }).action, 'send', body)
  assert.equal(decidePublicReply({ ...base, draftCategories: new Set(), category: 'billing' }).action, 'send')
  assert.equal(parseAutosendMode('ALL'), 'all')
  assert.equal(parseAutosendMode('yes'), 'off')
})

test('externalLinks lists only Betsy\'s own contact URLs as safe', () => {
  assert.deepEqual(externalLinks('https://betsycrm.com/x https://www.instagram.com/betsy_crm/ https://wa.me/50662470831', OWN), [])
  assert.equal(externalLinks('mirá https://betsycrm.com.evil.io/x', OWN).length, 1)
  assert.equal(externalLinks('wa.me/50611112222', OWN).length, 1)
})

test('reply tokens: per ticket, server-only key, expire after 72 h', async () => {
  const { replyToken, verifyReplyToken, withReplyToken, REPLY_TOKEN_TTL_SECONDS } = await import('../support/mcp/reply-token')
  const server = 's'.repeat(40)
  const now = new Date('2026-10-22T10:00:00Z')
  const tA = replyToken('ticketA', server, now)
  assert.match(tA, /^[0-9a-z]+\.[A-Za-z0-9_-]{32}$/)
  assert.equal(verifyReplyToken('ticketA', tA, server, now), true)
  assert.equal(verifyReplyToken('ticketB', tA, server, now), false)
  assert.equal(verifyReplyToken('ticketA', tA, 'other'.repeat(10), now), false, 'the MCP bearer cannot mint tokens')
  assert.equal(verifyReplyToken('ticketA', tA, undefined, now), false)
  assert.equal(verifyReplyToken('ticketA', undefined, server, now), false)
  const later = new Date(now.getTime() + (REPLY_TOKEN_TTL_SECONDS + 60) * 1000)
  assert.equal(verifyReplyToken('ticketA', tA, server, later), false, 'expired')
  const forgedExp = `${'zzzzzz'}.${tA.split('.')[1]}`
  assert.equal(verifyReplyToken('ticketA', forgedExp, server, now), false, 'expiry is signed')
  const p = { event: 'ticket.created', source: 'betsy', ticket: { id: 'ticketA' }, betsy: { ref: 'BETSY-1' } } as never
  assert.equal((withReplyToken(p, server, now) as any).betsy.reply_token, tA)
  assert.equal((withReplyToken(p, '') as any).betsy.reply_token, undefined)
  const sources = ['src/lib/support/dispatcher.ts', 'src/lib/support/mcp/tools.ts', 'src/app/api/support/events/route.ts']
  const { readFileSync } = await import('node:fs')
  for (const f of sources) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /ReplyToken\([^)]*NEXTAUTH_SECRET\)/, f)
    assert.doesNotMatch(src, /ReplyToken\([^)]*SUPPORT_MCP_TOKEN\)/, f)
  }
})

test('auto-send content rules catch lookalike domains, disguised numbers, ref variants and keys', () => {
  const base = {
    status: 'open', category: 'question', assignee: 'grok_agent', body: '', draftCategories: new Set<string>(),
    autosend: 'all' as const, signedIn: true, ref: 'BETSY-10', own: OWN,
  }
  for (const body of [
    'Entrá a betsу.com', // Cyrillic у
    'pagos-betsý.com',
    'Llamá al 8888/8888',
    'Llamá al 8888_8888',
    'Número ８８８８８８８８', // full-width
    'Igual que BETSY 1041',
    'Igual que #1041',
    'tu clave es sk9f8a7d6s5f4g3h2j1k0l9z8x7c',
  ]) {
    assert.equal(decidePublicReply({ ...base, body }).action, 'draft', body)
  }
  assert.equal(decidePublicReply({ ...base, body: 'Tu caso #10 está listo.' }).action, 'send')
  const off = decidePublicReply({ ...base, autosend: 'off', body: 'Pagá en evil.co' })
  assert.match((off as { reason: string }).reason, /Ojo! Incluye enlace/)
})

test('signed_in auto-send needs a verified account address on an in-app ticket', () => {
  const src = readFileSync('src/lib/support/mcp/tools.ts', 'utf8')
  assert.match(src, /if \(!t\.userId \|\| t\.source === 'contact_form'\) return false/)
  assert.match(src, /user\?\.emailVerified && user\.email && normalizeEmailKey\(user\.email\) === normalizeEmailKey\(t\.contactEmail\)/)
  assert.match(src, /isOwnSupportAddress\(t\.contactEmail\)/)
})

test('write tools require reply_token; read tools never return it', () => {
  const tools = supportMcpTools()
  for (const name of ['support_reply', 'support_update_ticket', 'support_escalate']) {
    const t = tools.find((x) => x.name === name)!
    assert.ok((t.inputSchema as { required: string[] }).required.includes('reply_token'), name)
    assert.equal(t.args.safeParse({ ticket_id: 'x', body: 'b', visibility: 'internal', reason: 'abc' }).success, false, name)
  }
})

test('support_update_ticket / set_status cannot undo the draft rule', async () => {
  const { agentUpdateRefusal } = await import('../support/mcp/reply-policy')
  const drafts = new Set(['billing', 'agent_request'])
  const open = { status: 'open', category: 'question', assignee: 'grok_agent' }
  assert.equal(agentUpdateRefusal(open, { status: 'resolved', category: 'bug' }, drafts), null)
  assert.match(agentUpdateRefusal({ ...open, category: 'billing' }, { category: 'question' }, drafts)!, /categoría/)
  assert.equal(agentUpdateRefusal({ ...open, category: 'billing' }, { category: 'agent_request' }, drafts), null)
  assert.match(agentUpdateRefusal({ ...open, status: 'spam' }, { status: 'open' }, drafts)!, /spam/)
  assert.match(agentUpdateRefusal({ ...open, status: 'escalated' }, { status: 'resolved' }, drafts)!, /escalado/)
  assert.match(agentUpdateRefusal({ ...open, assignee: 'rafael' }, { priority: 'low' } as never, drafts)!, /escalado/)
  assert.match(agentUpdateRefusal(open, { status: 'escalated' }, drafts)!, /support_escalate/)
})
