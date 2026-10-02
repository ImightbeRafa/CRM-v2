import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildVersionSnapshot,
  hashSnapshot,
  mergeScorecardParts,
  parseFeedbackInput,
  toScorecardRow,
  emptyCounts,
} from '@/lib/soft-ai/agent-scorecard'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const agent = {
  name: 'Ventas',
  systemInstructions: 'Sos el agente',
  tonePreset: 'warm_concise',
  model: 'gpt-6-luna',
  operationMode: 'ai_suggest',
  enabledTools: ['search_inventory', 'escalate_to_human'],
  paymentAlwaysHuman: true,
  status: 'live',
}

describe('version snapshots', () => {
  it('hash is stable regardless of key or tool order and changes with any content change', () => {
    const a = hashSnapshot(buildVersionSnapshot(agent))
    const reordered = hashSnapshot(
      buildVersionSnapshot({ ...agent, enabledTools: ['escalate_to_human', 'search_inventory'] }),
    )
    assert.equal(a, reordered)
    assert.notEqual(a, hashSnapshot(buildVersionSnapshot({ ...agent, systemInstructions: 'otra' })))
    assert.notEqual(a, hashSnapshot(buildVersionSnapshot({ ...agent, model: 'grok-4.7' })))
  })
  it('records the prompt code version', () => {
    assert.match(String(buildVersionSnapshot(agent).promptCodeVersion), /^prompt-/)
  })
})

describe('scorecard rates', () => {
  it('computes rates and uses null when there is nothing to rate', () => {
    const none = toScorecardRow(emptyCounts('a', 1))
    assert.equal(none.suggestionAcceptRate, null)
    assert.equal(none.thumbsDownRate, null)
    assert.equal(none.takeoverRate, 0)
    const row = toScorecardRow({
      ...emptyCounts('a', 2),
      delivered: 10,
      suggested: 5,
      fallback: 5,
      takeoverAfterSend: 2,
      attendedConversations: 8,
      convertedConversations: 2,
      suggestionsAccepted: 3,
      suggestionsEdited: 1,
      suggestionsDismissed: 4,
      thumbsUp: 3,
      thumbsDown: 1,
    })
    assert.equal(row.takeoverRate, 0.2)
    assert.equal(row.suggestionAcceptRate, 0.5)
    assert.equal(row.thumbsDownRate, 0.25)
    assert.equal(row.conversionRate, 0.25)
    assert.equal(row.fallbackRate, 5 / 20)
  })
  it('merges partial result sets per agent and version, newest version first', () => {
    const rows = mergeScorecardParts([
      [{ agentId: 'a', agentVersion: 1, delivered: 2, model: 'grok-4.7' }],
      [{ agentId: 'a', agentVersion: 1, suggestionsAccepted: 1 }, { agentId: 'a', agentVersion: 2, delivered: 1 }],
      [{ agentId: 'a', agentVersion: 1, thumbsUp: 4 }],
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows[0].agentVersion, 2)
    const v1 = rows[1]
    assert.equal(v1.delivered, 2)
    assert.equal(v1.suggestionsAccepted, 1)
    assert.equal(v1.thumbsUp, 4)
    assert.equal(v1.model, 'grok-4.7')
  })
})

describe('feedback input', () => {
  it('accepts a thumbs up and clears any reason', () => {
    const r = parseFeedbackInput({ turnId: 't1', rating: 1, reasonCode: 'wrong_tone' })
    assert.deepEqual(r, { ok: true, turnId: 't1', rating: 1, reasonCode: null, note: null })
  })
  it('accepts a thumbs down with a known reason and trims the note', () => {
    const r = parseFeedbackInput({ turnId: 't1', rating: -1, reasonCode: 'wrong_fact', note: '  precio mal ' })
    assert.deepEqual(r, { ok: true, turnId: 't1', rating: -1, reasonCode: 'wrong_fact', note: null })
  })
  it('rejects bad input', () => {
    for (const bad of [null, {}, { turnId: 't', rating: 2 }, { turnId: '', rating: 1 }, { turnId: 't', rating: -1, reasonCode: 'x' }]) {
      assert.equal(parseFeedbackInput(bad).ok, false)
    }
  })
})

describe('tenant isolation and gates (static)', () => {
  it('feedback checks the turn against the session tenant before writing', () => {
    const src = read('src/lib/soft-ai/agent-improvement.ts')
    assert.match(src, /chatAgentTurn\.findFirst\(\{\s*where: \{ id: input\.turnId, tenantId: input\.tenantId \}/)
  })
  it('tenant scorecard route passes the session tenant, platform route is super-admin only', () => {
    assert.match(read('src/app/api/chat/agents/scorecard/route.ts'), /tenantId: auth\.tenantId/)
    const platform = read('src/app/api/super-admin/agent-scorecard/route.ts')
    assert.match(platform, /isSuperAdmin\(auth\.userId\)/)
    assert.match(platform, /status: 404/)
  })
  it('eval route runs for the session tenant and needs update_config to run', () => {
    const src = read('src/app/api/chat/agents/[id]/eval/route.ts')
    assert.match(src, /'update_config'/)
    assert.match(src, /tenantId: auth\.tenantId/)
  })
  it('SQL 045 is additive, FK-free, RLS-enabled and registered', () => {
    const sql = read('supabase/migrations/045_agent_improvement.sql')
    for (const t of ['ChatAgentVersion', 'ChatAgentFeedback', 'ChatAgentEvalRun']) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\."${t}"`))
      assert.match(sql, new RegExp(`ALTER TABLE public\."${t}" ENABLE ROW LEVEL SECURITY`))
    }
    assert.doesNotMatch(sql, /REFERENCES|DROP |TRUNCATE|ALTER TABLE public\."Chat(Agent|Message|Conversation)Turn"/i)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'045': '045_agent_improvement\.sql'/)
  })
  it('agent edits snapshot the new version after the update commits', () => {
    const src = read('src/lib/soft-ai/agent-admin.ts')
    assert.match(src, /recordAgentVersionSnapshot\(/)
  })
})
