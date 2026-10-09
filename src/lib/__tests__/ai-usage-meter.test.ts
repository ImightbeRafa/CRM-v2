import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildAiUsageRow } from '@/lib/ai-usage/record'
import { withAiUsageContext } from '@/lib/ai-usage/context'
import { estimateAiCostMicros, estimateAudioSecondsFromBytes, aiProviderFor } from '@/lib/ai-usage/rate-card'

const read = (p: string) => readFileSync(p, 'utf8')

describe('AI usage meter (SQL 048)', () => {
  it('prices tokens and audio minutes; unknown models never read as free', () => {
    assert.equal(estimateAiCostMicros({ model: 'grok-4.7', inputTokens: 1_000_000, outputTokens: 0 }), 2_000_000)
    assert.equal(estimateAiCostMicros({ model: 'grok-4.7', inputTokens: 0, outputTokens: 1_000_000 }), 6_000_000)
    assert.equal(estimateAiCostMicros({ model: 'gpt-6-luna', inputTokens: 1_000_000, cachedTokens: 1_000_000 }), 10_000)
    assert.equal(estimateAiCostMicros({ model: 'whisper-1', audioSeconds: 60 }), 6_000)
    assert.ok(estimateAiCostMicros({ model: 'mystery-model', inputTokens: 1000 }) > 0)
    assert.equal(estimateAudioSecondsFromBytes(20_000), 10)
    assert.equal(aiProviderFor('gpt-6-luna'), 'openai')
    assert.equal(aiProviderFor('whisper-1'), 'openai')
    assert.equal(aiProviderFor('grok-4.6'), 'xai')
  })

  it('rows take the tenant from the ambient scope (staff bot entry points) unless given explicitly', () => {
    const scoped = withAiUsageContext({ tenantId: 't-1', feature: 'staff_bot' }, () =>
      buildAiUsageRow({ model: 'grok-4.6', inputTokens: 10, outputTokens: 5 }),
    )
    assert.equal(scoped.tenantId, 't-1')
    assert.equal(scoped.feature, 'staff_bot')
    const explicit = withAiUsageContext({ tenantId: 't-1' }, () =>
      buildAiUsageRow({ model: 'grok-4.7', tenantId: null, feature: 'inbox_agent' }),
    )
    assert.equal(explicit.tenantId, null)
    assert.equal(buildAiUsageRow({ model: 'grok-4.7' }).tenantId, null)
  })

  it('rows hold no text: only bounded ids, counts, cost and timing', () => {
    const row = buildAiUsageRow({ model: 'x'.repeat(500), errorCode: 'e'.repeat(500), inputTokens: -5, latencyMs: 12.7, status: 'error' })
    assert.equal(row.model.length, 80)
    assert.equal(row.errorCode?.length, 80)
    assert.equal(row.inputTokens, 0)
    assert.equal(row.latencyMs, 13)
    assert.equal(row.status, 'error')
    assert.ok(row.sourceKey.startsWith('evt:'))
    assert.deepEqual(
      Object.keys(row).sort(),
      ['agentId', 'audioSeconds', 'cachedTokens', 'conversationId', 'costMicros', 'errorCode', 'feature', 'id', 'inputTokens',
        'keyLabel', 'latencyMs', 'model', 'outputTokens', 'pricingVersion', 'provider', 'reasoningTokens', 'sourceKey',
        'status', 'tenantId', 'units', 'userId'].sort(),
    )
  })

  it('every inbox LLM call is metered, including failures (usage is a required argument)', () => {
    const client = read('src/lib/soft-ai/llm/client.ts')
    assert.match(client, /usage: \{\n?\s*tenantId: string \| null\n?\s*feature: AiUsageFeature/)
    assert.match(client, /status: 'error',\s*errorCode: aiErrorCode\(error\)/)
    const runtime = read('src/lib/soft-ai/llm/runtime.ts')
    // Every model call in the runtime (main loop, text-only final call, B7 rewrite) carries its usage tag.
    const calls = (runtime.match(/await softAiResponsesCreate\(\{/g) || []).length
    assert.ok(calls >= 3)
    assert.equal((runtime.match(/feature: input\.toolCtx\.sandbox \? 'probar' : 'inbox_agent'/g) || []).length, calls)
    assert.match(read('src/lib/soft-ai/shortcut-import-server.ts'), /feature: 'shortcut_import'/)
    assert.match(read('src/lib/customer-paste-grok.ts'), /feature: 'customer_paste'/)
  })

  it('every AI call site in the app records usage (5 known sites)', () => {
    assert.match(read('src/lib/bot/ai-agent.ts'), /recordAiUsage\(\{ feature: 'staff_bot'/)
    assert.match(read('src/lib/bot/whatsapp.ts'), /recordAiUsage\(\{ feature: 'staff_bot_voice', model: 'whisper-1'/)
    assert.match(read('src/app/api/bot/telegram/webhook/route.ts'), /recordAiUsage\(\{ feature: 'staff_bot_voice', model: 'whisper-1'/)
  })

  it('SQL 048 is additive, RLS on, idempotent by sourceKey, registered', () => {
    const sql = read('supabase/migrations/048_ai_usage_event.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."AiUsageEvent"/)
    assert.match(sql, /ALTER TABLE public\."AiUsageEvent" ENABLE ROW LEVEL SECURITY/)
    assert.match(sql, /UNIQUE \("sourceKey"\)/)
    assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /DROP |TRUNCATE|DELETE FROM|REFERENCES/i)
    assert.match(read('src/lib/ai-usage/record.ts'), /ON CONFLICT \("sourceKey"\) DO NOTHING/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'048': '048_ai_usage_event\.sql'/)
  })
})
