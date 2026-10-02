import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUILT_IN_SCENARIOS,
  MAX_CASES_PER_AGENT,
  evaluateStep,
  parseSavedTest,
  summarizeRun,
} from '@/lib/soft-ai/probar-scenarios'
import { AgentTestRequestSchema } from '@/lib/soft-ai/agent-test-schema'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

describe('built-in scenarios', () => {
  it('have unique ids, at least one step each, and valid regexes', () => {
    const ids = new Set<string>()
    for (const s of BUILT_IN_SCENARIOS) {
      assert.ok(!ids.has(s.id), `duplicate ${s.id}`)
      ids.add(s.id)
      assert.ok(s.steps.length >= 1, s.id)
      assert.ok(s.title && s.description, s.id)
      for (const step of s.steps) {
        assert.ok(step.text.trim(), s.id)
        for (const src of [...(step.expect?.forbidRegex ?? []), ...(step.expect?.requireAny ?? [])]) {
          assert.doesNotThrow(() => new RegExp(src, 'i'), `${s.id}: ${src}`)
        }
      }
    }
    assert.ok(BUILT_IN_SCENARIOS.length >= 15)
  })

  it('cover the safety cases that matter: payment proof, refund, opt-out, media, injection, window, human takeover', () => {
    const ids = BUILT_IN_SCENARIOS.map((s) => s.id)
    for (const id of ['payment_proof', 'refund', 'opt_out', 'media_voice', 'prompt_injection', 'window_closed', 'human_has_chat', 'contra_entrega_far', 'burst']) {
      assert.ok(ids.includes(id), id)
    }
  })

  it('never contain a brand, account id or phone number', () => {
    const json = JSON.stringify(BUILT_IN_SCENARIOS)
    assert.doesNotMatch(json, /Forge|cmuahn5y90001l504y6kksiek|\+?506\s?\d{4}/)
  })
})

describe('evaluateStep', () => {
  const base = { text: 'Con gusto le ayudo.', outcome: 'send' as const }

  it('passes a normal answer and enforces the safety defaults on every step', () => {
    assert.equal(evaluateStep(base, {}).pass, true)
    const confirmed = evaluateStep({ ...base, text: 'Listo, pago confirmado.' }, {})
    assert.equal(confirmed.pass, false)
    assert.match(confirmed.failures.join(' '), /confirmación de pago/)
    assert.equal(evaluateStep({ text: '', outcome: 'skip' }, {}).pass, false) // silent when it should answer
  })

  it('handoff expectations work both ways', () => {
    assert.equal(evaluateStep({ ...base, escalate: true }, { handoff: true }).pass, true)
    assert.equal(evaluateStep(base, { handoff: true }).pass, false)
    assert.equal(evaluateStep({ ...base, needsHuman: true }, { handoff: false }).pass, false)
  })

  it('silent expectation: quiet passes, a reply fails', () => {
    assert.equal(evaluateStep({ text: '', outcome: 'skip' }, { silent: true }).pass, true)
    assert.equal(evaluateStep(base, { silent: true }).pass, false)
  })

  it('forbid phrases ignore case and accents; regexes are case-insensitive; length cap works', () => {
    assert.equal(evaluateStep({ ...base, text: 'Sí, hay MASCOTAS permitidas' }, { forbidText: ['mascotas'] }).pass, false)
    assert.equal(evaluateStep({ ...base, text: 'Es GRATIS claro' }, { forbidRegex: ['gratis.{0,10}claro'] }).pass, false)
    assert.equal(evaluateStep({ ...base, text: 'x'.repeat(400) }, { maxChars: 300 }).pass, false)
    assert.equal(evaluateStep({ ...base, text: 'Precio ₡25 000' }, { requireAny: ['₡\\s?\\d'] }).pass, true)
    assert.equal(evaluateStep(base, { requireAny: ['₡\\s?\\d'] }).pass, false)
  })

  it('a hit of the daily test cap is "not run", never a pass or a fail', () => {
    const r = evaluateStep({ text: '', blockedBy: ['test_budget_blocked'] }, { handoff: true })
    assert.equal(r.notRun, true)
    assert.equal(r.pass, false)
    const sum = summarizeRun([{ pass: true }, { pass: false }, { pass: false, notRun: true }])
    assert.deepEqual(sum, { examined: 2, passed: 1, passRate: 0.5, notRun: 1 })
  })

  it('an invalid saved regex can never throw', () => {
    assert.doesNotThrow(() => evaluateStep(base, { forbidRegex: ['('] }))
  })
})

describe('saved tests input', () => {
  const ok = { title: 'Precio con envío', steps: [{ text: 'hola' }, { text: 'precio?', expect: { handoff: false, forbidText: ['gratis'] } }] }

  it('accepts a valid test and keeps only known fields', () => {
    const r = parseSavedTest({ ...ok, steps: [{ text: 'hola', evil: 'x', expect: { forbidRegex: ['.*'], handoff: true } }] })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.deepEqual(r.value.steps[0], { text: 'hola', expect: { handoff: true } }) // regex dropped: plain phrases only
      assert.equal('evil' in r.value.steps[0], false)
    }
  })

  it('rejects empty, oversized and malformed tests', () => {
    assert.equal(parseSavedTest(null).ok, false)
    assert.equal(parseSavedTest({ title: '', steps: [{ text: 'x' }] }).ok, false)
    assert.equal(parseSavedTest({ title: 'x', steps: [] }).ok, false)
    assert.equal(parseSavedTest({ title: 'x', steps: Array.from({ length: 13 }, () => ({ text: 'x' })) }).ok, false)
    assert.equal(parseSavedTest({ title: 'x', steps: [{ text: '  ' }] }).ok, false)
    assert.equal(parseSavedTest({ ...ok, title: 'x'.repeat(200) }).ok, true) // trimmed to 80, not rejected
    const long = parseSavedTest({ ...ok, title: 'x'.repeat(200) })
    if (long.ok) assert.equal(long.value.title.length, 80)
  })

  it('limits exist', () => {
    assert.equal(MAX_CASES_PER_AGENT, 50)
  })
})

describe('compare mode request', () => {
  const base = { inboundText: 'hola', socialAccountId: 's1', testSessionId: '2c3b8f7e-1b0f-4b8e-9c3a-1d2e3f4a5b6c' }
  it('accepts only allowlisted model overrides', () => {
    assert.equal(AgentTestRequestSchema.safeParse({ ...base, modelOverride: 'gpt-6-luna' }).success, true)
    assert.equal(AgentTestRequestSchema.safeParse({ ...base, modelOverride: 'gpt-4o' }).success, false)
    assert.equal(AgentTestRequestSchema.safeParse(base).success, true)
  })
})

describe('server and UI wiring (static)', () => {
  it('the override is test-only: validated, provider key required, never written to the agent', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    const test = turn.slice(turn.indexOf('export async function runAgentTestTurn'))
    assert.match(test, /isAllowedChatAgentModel\(input\.modelOverride\)/)
    assert.match(test, /isSoftAiProviderConfigured\(input\.modelOverride\)/)
    assert.match(test, /\{ \.\.\.baseRuntimeAgent, model: input\.modelOverride \}/)
    assert.doesNotMatch(test, /chatAgent\.update/)
    assert.match(test, /estimatedCostUsd/)
  })

  it('saved-test routes: tenant from session, agent ownership checked, writes need update_config and are audited', () => {
    const list = read('src/app/api/chat/agents/[id]/test-cases/route.ts')
    assert.match(list, /'view_config'/)
    assert.match(list, /'update_config'/)
    assert.match(list, /auth\.tenantId/)
    assert.match(list, /logAuditEvent/)
    assert.match(read('src/app/api/chat/agents/[id]/test-cases/[caseId]/route.ts'), /deleteTestCase\(auth\.tenantId, id, caseId\)/)
    const server = read('src/lib/soft-ai/probar-test-cases.ts')
    assert.match(server, /ownsAgent\(tenantId, agentId\)/)
    assert.match(server, /"tenantId" = \$\{tenantId\} AND "agentId" = \$\{agentId\}/)
    assert.match(server, /< \$\{MAX_CASES_PER_AGENT\}/)
    assert.match(server, /pg_advisory_xact_lock/)
  })

  it('the playground sends nothing to customers: only the Probar test endpoint is called to play scenarios', () => {
    const ui = read('src/app/config/agentes/ProbarScenarios.tsx')
    assert.doesNotMatch(ui, /\/api\/chat\/send|send-media|\/api\/bot/)
    assert.match(ui, /\/test`/)
    assert.match(ui, /Probar no envía nada a nadie/)
    assert.match(ui, /data-testid="probar-mode-badge"/)
  })

  it('SQL 047 is additive, FK-free, RLS-enabled, bounded and registered', () => {
    const sql = read('supabase/migrations/047_chat_agent_test_cases.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAgentTestCase"/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(sql, /REFERENCES|DROP |TRUNCATE/i)
    assert.match(sql, /jsonb_array_length\("steps"\) BETWEEN 1 AND 12/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'047': '047_chat_agent_test_cases\.sql'/)
  })

  it('a product-list change is a new agent version with its own snapshot', () => {
    const route = read('src/app/api/chat/agents/[id]/inventory/route.ts')
    assert.match(route, /version: \{ increment: 1 \}/)
    assert.match(route, /recordAgentVersionSnapshot\(/)
    assert.match(route, /inventoryItemIds: \(mappedNow \?\? \[\]\)\.slice\(0, 50\)/)
    assert.match(read('src/lib/soft-ai/agent-scorecard.ts'), /inventoryItemIds: agent\.inventoryItemIds/)
  })
})
