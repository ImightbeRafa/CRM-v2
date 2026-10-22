/**
 * Lane D 2026-10-22: an AI provider outage (OpenAI 429 "no credits", 07:19–10:25 CR) never strands a chat — the customer
 * message is retried (silently first), then a person takes the chat; the owner is alerted once; tests have their own cap.
 * Run: npx tsx --import ./scripts/shim-server-only.mjs --test src/lib/__tests__/provider-outage.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  alertsOwner,
  classifyProviderFailure,
  planProviderRetry,
  PROVIDER_RETRY_DELAYS_MIN,
  readProviderRetryState,
  type ProviderRetryState,
} from '@/lib/soft-ai/provider-outage-core'
import { assertTestBudget, costaRicaDayStartUtc, testDailyCapMicros } from '@/lib/soft-ai/provider-outage'
import { HANDOFF_REASON_LABELS } from '@/lib/workspace-notifications'

const read = (p: string) => readFileSync(p, 'utf8')
const err = (status: number | null, extra: Record<string, unknown> = {}, message = 'x') => Object.assign(new Error(message), status === null ? {} : { status }, extra)

describe('provider failures', () => {
  it('are classified; our own bugs are not', () => {
    assert.equal(classifyProviderFailure(err(429, { code: 'insufficient_quota' })), 'quota')
    assert.equal(classifyProviderFailure(err(429, {}, 'You exceeded your current quota, please check your plan and billing details')), 'quota')
    assert.equal(classifyProviderFailure(err(429)), 'rate_limit')
    assert.equal(classifyProviderFailure(err(401)), 'auth')
    assert.equal(classifyProviderFailure(err(403)), 'auth')
    assert.equal(classifyProviderFailure(err(503)), 'server')
    assert.equal(classifyProviderFailure(err(null, {}, 'Request timed out.')), 'timeout')
    assert.equal(classifyProviderFailure(err(null, {}, 'fetch failed')), 'network')
    assert.equal(classifyProviderFailure(new Error('LLM_NOT_CONFIGURED')), 'not_configured')
    assert.equal(classifyProviderFailure(err(400)), null)
    assert.equal(classifyProviderFailure(new TypeError('cannot read x of undefined')), null)
    assert.equal(alertsOwner('quota'), true)
    assert.equal(alertsOwner('timeout'), false)
  })
})

describe('retry plan for one customer message', () => {
  const t0 = new Date('2026-10-22T13:19:00Z')
  const farWindow = new Date(t0.getTime() + 20 * 3_600_000)
  it('silent at +2 min, then the safe line once, then 5/15/30/60 min, then a person (~2 h)', () => {
    let prev: ProviderRetryState | null = null
    let now = t0
    const seen: string[] = []
    for (let i = 0; i < 10; i++) {
      const plan = planProviderRetry({ previous: prev, kind: 'quota', now, windowClosesAt: farWindow })
      seen.push(`${plan.action}${plan.sendAck ? '+ack' : ''}`)
      if (plan.action === 'handoff') break
      prev = plan.state
      now = plan.retryAt
    }
    assert.deepEqual(seen, ['retry', 'retry+ack', 'retry', 'retry', 'retry', 'handoff'])
    assert.ok(now.getTime() - t0.getTime() <= 2 * 3_600_000)
    assert.equal(PROVIDER_RETRY_DELAYS_MIN.reduce((a, b) => a + b, 0), 112)
  })
  it('a first retry lands at +2 min', () => {
    const plan = planProviderRetry({ previous: null, kind: 'rate_limit', now: t0, windowClosesAt: farWindow })
    assert.equal(plan.action, 'retry')
    assert.equal(plan.action === 'retry' && plan.retryAt.getTime() - t0.getTime(), 2 * 60_000)
    assert.equal(plan.sendAck, false)
  })
  it('a closing 24 h window or a missing key hands off at once, with the safe line if it never went out', () => {
    const closing = planProviderRetry({ previous: null, kind: 'server', now: t0, windowClosesAt: new Date(t0.getTime() + 5 * 60_000) })
    assert.equal(closing.action, 'handoff')
    assert.equal(closing.sendAck, true)
    const noKey = planProviderRetry({ previous: null, kind: 'not_configured', now: t0, windowClosesAt: farWindow })
    assert.equal(noKey.action, 'handoff')
    const ackDone = planProviderRetry({ previous: { n: 4, firstAt: t0.toISOString(), ackSent: true }, kind: 'quota', now: new Date(t0.getTime() + 112 * 60_000), windowClosesAt: farWindow })
    assert.equal(ackDone.action, 'handoff')
    assert.equal(ackDone.sendAck, false)
  })
  it('the state survives the job payload, junk does not', () => {
    assert.deepEqual(readProviderRetryState({ providerRetry: { n: 2, firstAt: t0.toISOString(), ackSent: true, kind: 'quota' } }), { n: 2, firstAt: t0.toISOString(), ackSent: true, kind: 'quota' })
    assert.equal(readProviderRetryState({ providerRetry: { n: 2, firstAt: 'nope' } }), null)
    assert.equal(readProviderRetryState(null), null)
  })
})

describe('test budget', () => {
  it('has a hard daily cap in USD (env, default 15) on the Costa Rica day', () => {
    assert.equal(testDailyCapMicros(undefined), 15_000_000)
    assert.equal(testDailyCapMicros('40'), 40_000_000)
    assert.equal(testDailyCapMicros('-3'), 15_000_000)
    assert.equal(costaRicaDayStartUtc(new Date('2026-10-22T05:00:00Z')).toISOString(), '2026-10-21T06:00:00.000Z')
    assert.equal(costaRicaDayStartUtc(new Date('2026-10-22T07:00:00Z')).toISOString(), '2026-10-22T06:00:00.000Z')
  })
  it('never checks live features', async () => {
    await assertTestBudget('inbox_agent')
    await assertTestBudget('payment_check')
    await assertTestBudget(null)
  })
})

describe('wiring', () => {
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  it('the live turn retries a provider failure instead of sending the safe line and stopping', () => {
    assert.match(turn, /const llm = await runSoftAiLlmRuntime\(runtimeInput\)\r?\n\s*\/\/[^\n]*\r?\n\s*\/\/[^\n]*\r?\n\s*if \(llm\.fallbackUsed && llm\.providerFailure && llm\.handoff\?\.kind !== 'handoff'\) \{\r?\n\s*return handleProviderOutage\(/)
    assert.match(turn, /await settleHandoff\(row, \{ kind: 'handoff', reason: HANDOFF_REASON\.aiUnavailable \}, input\.hours\)/)
    assert.match(turn, /deliveryKey: `\$\{row\.deliveryKey\}\$\{OUTAGE_ACK_SUFFIX\}`/)
    assert.match(HANDOFF_REASON_LABELS.ai_unavailable, /IA sin servicio/)
  })
  it('the processor reschedules the same job; rearm ignores the outage line', () => {
    assert.match(read('src/lib/soft-ai/automation-processor.ts'), /result\.status === 'provider_retry'\) \{[\s\S]{0,120}await rescheduleJob\(row, result\.retryAt, result\.payload\)/)
    const q = read('src/lib/soft-ai/automation-queue.ts')
    assert.match(q, /where: \{ id: row\.id, status: 'processing', leaseToken: row\.leaseToken \},\s+data: \{\s+status: 'retry',\s+availableAt: retryAt,/)
    assert.match(q, /deliveryKey: \{ endsWith: ':outage_ack' \}/)
  })
  it('every Soft AI call checks the test budget first and reports provider health', () => {
    const c = read('src/lib/soft-ai/llm/client.ts')
    assert.ok(c.indexOf('await assertTestBudget(args.usage?.feature)') < c.indexOf('client.responses.create('))
    assert.match(c, /void noteProviderOk\(\)/)
    assert.match(c, /void noteProviderFailure\(error\)/)
  })
  it('SQL 060 is additive, RLS on, registered', () => {
    const sql = read('supabase/migrations/060_ai_provider_status.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."AiProviderStatus"/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(sql, /DROP|ALTER TABLE public\."(?!AiProviderStatus)/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'060': '060_ai_provider_status\.sql'/)
  })
})
