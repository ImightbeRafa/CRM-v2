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
    // Verifier: a plain rate limit never alerts (it flaps at peak traffic); a 429 for missing credit is 'quota'.
    assert.equal(alertsOwner('rate_limit'), false)
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
  it('never checks live features or the activation canary; is per business', async () => {
    await assertTestBudget('inbox_agent', 't1')
    await assertTestBudget('payment_check', 't1')
    await assertTestBudget('agent_activation', 't1')
    await assertTestBudget(null, 't1')
    await assertTestBudget('probar', null)
    assert.ok(read('src/lib/soft-ai/provider-outage.ts').includes(`WHERE "tenantId" = \${tenantId} AND "feature" IN ('probar', 'agent_test')`))
    assert.ok(read('src/lib/soft-ai/agent-unlock.ts').includes("usageFeature: 'agent_activation'"))
  })
})

describe('SecureDog r1 fixes', () => {
  const t0 = new Date('2026-10-22T13:19:00Z')
  const far = new Date(t0.getTime() + 20 * 3_600_000)
  it('INT-222: a timeout / network failure gets two retries, then a person; retries spread ±20 %', () => {
    let prev: ProviderRetryState | null = null
    const seen: string[] = []
    let now = t0
    for (let i = 0; i < 6; i++) {
      const plan = planProviderRetry({ previous: prev, kind: 'timeout', now, windowClosesAt: far })
      seen.push(plan.action)
      if (plan.action === 'handoff') break
      prev = plan.state
      now = plan.retryAt
    }
    assert.deepEqual(seen, ['retry', 'retry', 'handoff'])
    const early = planProviderRetry({ previous: null, kind: 'quota', now: t0, windowClosesAt: far, jitter: 0 })
    const late = planProviderRetry({ previous: null, kind: 'quota', now: t0, windowClosesAt: far, jitter: 1 })
    assert.equal(early.action === 'retry' && early.retryAt.getTime() - t0.getTime(), Math.round(2 * 60_000 * 0.8))
    assert.equal(late.action === 'retry' && late.retryAt.getTime() - t0.getTime(), Math.round(2 * 60_000 * 1.2))
  })
  it('INT-217: with payment in play an outage hands the chat over as a payment at once', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.includes('paymentInPlay: paymentCheckGate(burst.inboundText, history),'))
    assert.ok(turn.includes("await sendOutageLine({ ...input, now, text: SAFE_LINE.payment })"))
    assert.ok(turn.includes("await settleHandoff(row, { kind: 'handoff', reason: HANDOFF_REASON.payment }, input.hours)"))
  })
  it('INT-219: both code lines use the pre-send token rule; INT-216 alert keys per hour; F4 env reaches the container', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal(turn.split("(tokenStatus === 'valid' || tokenStatus === 'expiring')").length - 1, 2)
    const o = read('src/lib/soft-ai/provider-outage.ts')
    assert.ok(o.includes("now.toISOString().slice(0, 13)"))
    const w = read('src/cf-container-worker.ts')
    assert.ok(w.includes('"AI_TEST_DAILY_USD_CAP",') && w.includes('AI_TEST_DAILY_USD_CAP?: string;'))
  })
})

describe('Verifier r1 fixes', () => {
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  it('one outage line per chat, night wording, the customer message stays unanswered', () => {
    const fn = turn.slice(turn.indexOf('async function sendOutageLine('), turn.indexOf('export function rebillTurnFields'))
    assert.ok(fn.includes('await safeLineSentRecently(row.tenantId, row.conversationId, row.deliveryKey)'))
    assert.ok(fn.includes("intent: 'outage_ack', status: 'delivered', completedAt: { gte:"))
    assert.ok(fn.includes('input.hours.afterHours ? afterHoursReviewLine(input.hours.label, input.hours.transparent) : SAFE_LINE.review'))
    assert.ok(fn.includes('answersMessageId: previousInbound?.id ?? null,'))
  })
  it('the sweep does not treat the outage line as an answer; a stranded provider_retry is re-armed', () => {
    const sweep = read('src/lib/soft-ai/waiting-sweep.ts')
    assert.ok(sweep.includes('meta?.outageAck !== true'))
    assert.ok(sweep.includes("'provider_retry',"))
  })
  it('a late (post-timeout) retry keeps retrying; retries never use up MAX_ATTEMPTS', () => {
    const proc = read('src/lib/soft-ai/automation-processor.ts')
    assert.ok(proc.includes('? rescheduleLateJob(row, late.retryAt, late.payload)'))
    assert.ok(proc.includes(': completeLateJob(row)'))
    assert.equal(read('src/lib/soft-ai/automation-queue.ts').split('attempts: { decrement: 1 }').length - 1, 2)
  })
  it('a missing key reaches the alert; a test-budget stop shows in Probar', () => {
    const c = read('src/lib/soft-ai/llm/client.ts')
    const create = c.indexOf('client = createSoftAiClient(model, timeoutMs)')
    assert.ok(create > 0 && c.indexOf('void noteProviderFailure(error)', create) - create < 200)
    assert.ok(turn.includes("llm.errorCode === 'TEST_BUDGET_EXCEEDED' && !blockedBy.includes('test_budget_blocked')"))
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
    assert.ok(c.indexOf('await assertTestBudget(args.usage?.feature, args.usage?.tenantId ?? null)') < c.indexOf('client.responses.create('))
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
