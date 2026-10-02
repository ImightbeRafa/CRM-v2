import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clampUsageDays,
  parseUsageMode,
  stripSummaryCost,
  summarizeAgentUsage,
  type AgentUsageRow,
} from '@/lib/soft-ai/agent-usage'

const row = (over: Partial<AgentUsageRow>): AgentUsageRow => ({
  day: '2026-10-01',
  tenantId: 't1',
  agentId: 'a1',
  model: 'gpt-6-luna',
  mode: 'ai_full',
  status: 'delivered',
  turns: 1,
  inputTokens: 1000,
  cachedInputTokens: 0,
  outputTokens: 100,
  costMicros: 150,
  ...over,
})

describe('summarizeAgentUsage', () => {
  const rows = [
    row({ turns: 8 }),
    row({ status: 'suggested', turns: 2 }),
    row({ status: 'fallback', turns: 1 }),
    row({ status: 'failed', turns: 1 }),
    row({ status: 'skipped', turns: 3 }),
    row({ mode: 'test', status: 'test', turns: 5, tenantId: 't2' }),
    row({ model: 'grok-4.7', tenantId: 't2', turns: 4, costMicros: 8_000 }),
  ]

  it('live mode excludes Probar turns', () => {
    const s = summarizeAgentUsage(rows, 'live')
    assert.equal(s.totals.turns, 8 + 2 + 1 + 1 + 3 + 4)
    assert.equal(s.byTenant.some((t) => t.tenantId === 't2' && t.turns === 5), false)
  })

  it('test mode counts only Probar and all counts everything', () => {
    assert.equal(summarizeAgentUsage(rows, 'test').totals.turns, 5)
    assert.equal(summarizeAgentUsage(rows, 'all').totals.turns, 8 + 2 + 1 + 1 + 3 + 5 + 4)
  })

  it('computes rates over attempted turns only (not skipped)', () => {
    const s = summarizeAgentUsage(rows, 'live', 4200)
    const attempted = 8 + 2 + 1 + 1 + 4
    assert.equal(s.totals.fallbackRate, 1 / attempted)
    assert.equal(s.totals.failureRate, 1 / attempted)
    assert.equal(s.totals.p95LatencyMs, 4200)
  })

  it('sums cost in dollars per model', () => {
    const s = summarizeAgentUsage(rows, 'live')
    const grok = s.byModel.find((m) => m.model === 'grok-4.7')
    assert.ok(grok)
    assert.equal(grok.costUsd, 0.008)
  })
})

describe('tenant view never shows dollars', () => {
  it('stripSummaryCost removes costUsd everywhere and drops other tenants', () => {
    const stripped = stripSummaryCost(summarizeAgentUsage([row({})], 'live'))
    const json = JSON.stringify(stripped)
    assert.equal(json.includes('costUsd'), false)
    assert.equal('byTenant' in stripped, false)
  })
})

describe('query parsing', () => {
  it('clamps days to 1..90 with a 30 day default', () => {
    assert.equal(clampUsageDays(undefined), 30)
    assert.equal(clampUsageDays('abc'), 30)
    assert.equal(clampUsageDays('0'), 30)
    assert.equal(clampUsageDays('7'), 7)
    assert.equal(clampUsageDays('9999'), 90)
  })
  it('defaults mode to live', () => {
    assert.equal(parseUsageMode(undefined), 'live')
    assert.equal(parseUsageMode('test'), 'test')
    assert.equal(parseUsageMode('all'), 'all')
    assert.equal(parseUsageMode('x'), 'live')
  })
})

describe('route gates (static)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

  it('platform route is super-admin only and returns 404 to others', () => {
    const src = read('src/app/api/super-admin/agent-usage/route.ts')
    assert.match(src, /isSuperAdmin\(auth\.userId\)/)
    assert.match(src, /status: 404/)
    assert.doesNotMatch(src, /req\.nextUrl\.searchParams\.get\('tenantId'\)/)
  })

  it('tenant route takes the tenant only from the session', () => {
    const src = read('src/app/api/chat/agents/usage/route.ts')
    assert.match(src, /tenantId: auth\.tenantId/)
    assert.doesNotMatch(src, /searchParams\.get\('tenantId'\)/)
    assert.match(src, /stripSummaryCost/)
  })
})
