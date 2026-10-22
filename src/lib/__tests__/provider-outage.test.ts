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
import { assertTestBudget, effectiveTestCap, testAwareFeature, testDailyTokenCeiling, testDayStartUtc } from '@/lib/soft-ai/provider-outage'
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
  it('the business cap never passes the platform ceiling (env only, default 2M tokens), on the "pruebas hoy" day', () => {
    assert.equal(testDailyTokenCeiling(undefined), 2_000_000)
    assert.equal(testDailyTokenCeiling('5000000'), 5_000_000)
    assert.equal(testDailyTokenCeiling('-3'), 2_000_000)
    // 2026-10-22: an exam raised the cap to 12M (37.8M spent on an 800k cap): the ceiling still holds.
    assert.equal(effectiveTestCap(12_000_000, 2_000_000), 2_000_000)
    assert.equal(effectiveTestCap(40_000_000, 2_000_000), 2_000_000)
    assert.equal(effectiveTestCap(800_000, 2_000_000), 800_000)
    assert.equal(effectiveTestCap(0, 2_000_000), 2_000_000)
    assert.equal(testDayStartUtc(new Date('2026-10-22T05:00:00Z')).toISOString(), '2026-10-22T00:00:00.000Z')
  })
  it('every call inside a test turn is test spend; live calls never are', () => {
    assert.equal(testAwareFeature('payment_check', { test: true, feature: 'agent_test' }), 'agent_test')
    assert.equal(testAwareFeature('vision', { test: true, feature: 'probar' }), 'probar')
    assert.equal(testAwareFeature('payment_check', { test: true }), 'agent_test')
    assert.equal(testAwareFeature('payment_check', undefined), 'payment_check')
    assert.equal(testAwareFeature('inbox_agent', { feature: 'staff_bot' } as { feature: string }), 'inbox_agent')
    assert.equal(testAwareFeature('agent_test', undefined), 'agent_test')
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.ok(turn.includes("withAiUsageContext({ tenantId: input.tenantId, feature, test: true }, () => runAgentTestTurnInner(input))"))
    const o = read('src/lib/soft-ai/provider-outage.ts')
    assert.ok(o.includes('SUM("inputTokens" + "outputTokens")'))
    assert.ok(o.includes('cap = effectiveTestCap(parseChatAgentLayerConfig(layer.config).testDailyTokenCap)'))
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
    // Verifier r2 #6: only the unanswered messages; the payment line only for a claim (else the review line).
    assert.ok(turn.includes('paymentInPlay: paymentCheckGate(burst.inboundText, []),'))
    assert.ok(turn.includes("paymentClaim: classifyPaymentText(burst.inboundText) === 'payment_proof_or_risk',"))
    assert.ok(turn.includes('await sendOutageLine({ ...input, now, text: input.paymentClaim ? SAFE_LINE.payment : undefined })'))
    // Verifier r2 #3: the 2 h clock is the conversation's (a new job continues the chat's outage).
    assert.ok(turn.includes('previous: readProviderRetryState(row.payload) ?? (await conversationRetryState(row, now)),'))
    assert.ok(turn.includes("skipReason: 'provider_retry', createdAt: { gte: new Date(now.getTime() - PROVIDER_RETRY_MAX_MS) }"))
    // Verifier r2 #5: one alert per incident; a new incident re-alerts 10 min after the last recovery; "volvió" always follows a "down".
    const o = read('src/lib/soft-ai/provider-outage.ts')
    assert.ok(o.includes("await alertOwner('down', `${kind}:${new Date(claimed[0].downSince).toISOString()}`, kind!)"))
    assert.ok(o.includes('AND ("recoveredAt" IS NULL OR "recoveredAt" <= ${new Date(now.getTime() - REALERT_AFTER_RECOVERY_MS)})'))
    assert.ok(o.includes("if (closed[0]?.alertedAt) await alertOwner('up', new Date(closed[0].downSince).toISOString())"))
    assert.ok(turn.includes("await settleHandoff(row, { kind: 'handoff', reason: HANDOFF_REASON.payment }, input.hours)"))
  })
  it('INT-219: both code lines use the pre-send token rule; INT-216 alert keys per hour; F4 env reaches the container', () => {
    const turn = read('src/lib/soft-ai/agent-turn.ts')
    assert.equal(turn.split("(tokenStatus === 'valid' || tokenStatus === 'expiring')").length - 1, 2)
    const o = read('src/lib/soft-ai/provider-outage.ts')
    assert.ok(o.includes("now.toISOString().slice(0, 13)"))
    const w = read('src/cf-container-worker.ts')
    assert.ok(w.includes('"AI_TEST_DAILY_TOKEN_CAP",') && w.includes('AI_TEST_DAILY_TOKEN_CAP?: string;'))
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
    const check = c.indexOf('await assertTestBudget(usage.feature, usage.tenantId ?? null)')
    assert.ok(check > 0 && check < c.indexOf('client.responses.create('))
    assert.ok(c.includes('feature: testAwareFeature(args.usage.feature, currentAiUsageContext())'))
    assert.equal(c.split('      ...usage,').length - 1, 2)
    assert.match(c, /void noteProviderOk\(\)/)
    assert.match(c, /void noteProviderFailure\(error\)/)
  })
  it('SQL 061 is additive, RLS on, registered', () => {
    const sql = read('supabase/migrations/061_ai_provider_status.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."AiProviderStatus"/)
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
    assert.doesNotMatch(sql, /DROP|ALTER TABLE public\."(?!AiProviderStatus)/)
    assert.match(read('scripts/lib/betsy-v2-additive-manifest.mjs'), /'061': '061_ai_provider_status\.sql'/)
  })
})
