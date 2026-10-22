import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { checkMcpBearer } from '../support/mcp/auth'
import { MCP_PROTOCOL_VERSION, RPC, ToolError, handleMcpMessage, type McpTool } from '../support/mcp/protocol'
import { decidePublicReply, externalLinks } from '../support/mcp/reply-policy'

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

test('reply policy: billing/agent_request/escalated/external links → draft; spam → refuse; else send', () => {
  const base = { status: 'open', category: 'question', assignee: 'grok_agent', body: 'Hola, así se hace.', draftCategories: new Set(['billing', 'agent_request']) }
  assert.deepEqual(decidePublicReply(base), { action: 'send' })
  assert.equal(decidePublicReply({ ...base, status: 'spam' }).action, 'refuse')
  assert.equal(decidePublicReply({ ...base, category: 'billing' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, category: 'agent_request' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, status: 'escalated' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, assignee: 'rafael' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, body: 'Entrá a https://evil.example/login' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, body: 'Ingresá a evil.co/login ya' }).action, 'draft')
  assert.equal(decidePublicReply({ ...base, body: 'Guía: https://www.betsycrm.com/help/billing o https://wa.me/50662470831' }).action, 'send')
  assert.equal(decidePublicReply({ ...base, draftCategories: new Set() , category: 'billing' }).action, 'send')
})

test('externalLinks lists only non-Betsy hosts', () => {
  assert.deepEqual(externalLinks('https://betsycrm.com/x https://www.instagram.com/betsy_crm/'), [])
  assert.equal(externalLinks('mirá https://betsycrm.com.evil.io/x').length, 1)
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
