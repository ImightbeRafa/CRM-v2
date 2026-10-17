/**
 * agents2-pace — "Velocidad de respuesta" (instant / natural / calm typing waits before each message of a live
 * reply, WhatsApp "escribiendo…" best effort) and the quick check's "why" for a failed case (+ one retry when the
 * failure was only technical). Pure functions + source asserts (no database, no network, no waits).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_REPLY_PACE,
  MAX_TURN_PACING_MS,
  PACE_DEADLINE_RESERVE_MS,
  paceNoteText,
  parseReplyPace,
  planPartWait,
  REPLY_PACE_OPTIONS,
  replyPaceSchema,
  typingDelayMs,
  type ReplyPace,
} from '@/lib/soft-ai/reply-pace'
import { REPLY_PART_GAP_MS } from '@/lib/soft-ai/reply-parts'
import {
  attemptCostMicros,
  caseWhy,
  isTechnicalOnlyFailure,
  probarOutcomeCodes,
  shouldRetryCase,
  TIMEOUT_ATTEMPT_COST_MICROS,
} from '@/lib/soft-ai/test-engine/why'

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

const T0 = 1_000_000
const DEADLINE = T0 + 38_000

/** Simulates a turn: first message after `modelMs` of model time, each send takes `sendMs`. Returns the waits. */
function simulate(pace: ReplyPace, lengths: number[], modelMs: number, sendMs = 300) {
  let now = T0 + modelMs
  let lastSentAt = T0
  let paced = 0
  const waits: number[] = []
  for (let i = 0; i < lengths.length; i += 1) {
    const w = planPartWait({ pace, index: i, chars: lengths[i], now, spentMs: now - lastSentAt, pacedSoFarMs: paced, deadlineAt: DEADLINE })
    if (w.late) {
      waits.push(-1)
      break
    }
    waits.push(w.waitMs)
    now += w.waitMs
    paced += w.waitMs
    now += sendMs
    lastSentAt = now
  }
  return waits
}

describe('agents2-pace: typing delay per message', () => {
  it('natural ≈ 1.2 s + 35 ms/char, clamped 1.5–6 s', () => {
    assert.equal(typingDelayMs('natural', 0), 1_500)
    assert.equal(typingDelayMs('natural', 60), 3_300)
    assert.equal(typingDelayMs('natural', 120), 5_400)
    assert.equal(typingDelayMs('natural', 500), 6_000)
  })
  it('calm ≈ 2 s + 55 ms/char, clamped 3–9 s', () => {
    assert.equal(typingDelayMs('calm', 0), 3_000)
    assert.equal(typingDelayMs('calm', 60), 5_300)
    assert.equal(typingDelayMs('calm', 120), 8_600)
    assert.equal(typingDelayMs('calm', 500), 9_000)
  })
  it('instant = old behaviour: nothing before the first message, 700 ms between messages', () => {
    assert.equal(typingDelayMs('instant', 300), 0)
    assert.equal(REPLY_PART_GAP_MS, 700)
    assert.deepEqual(simulate('instant', [60, 120, 110], 4_000), [0, 700, 700])
  })
})

describe('agents2-pace: planPartWait', () => {
  it('model latency counts as typing (first message may go at once)', () => {
    const base = { pace: 'natural' as const, index: 0, chars: 60, now: T0, pacedSoFarMs: 0, deadlineAt: DEADLINE }
    assert.equal(planPartWait({ ...base, spentMs: 0 }).waitMs, 3_300)
    assert.equal(planPartWait({ ...base, spentMs: 2_000 }).waitMs, 1_300)
    assert.equal(planPartWait({ ...base, spentMs: 5_000 }).waitMs, 0)
    // A clock skew (inbound in the future) never adds time.
    assert.equal(planPartWait({ ...base, spentMs: -4_000 }).waitMs, 3_300)
  })
  it('sample 3-part close (60/120/110 chars, model 4 s, send 300 ms)', () => {
    assert.deepEqual(simulate('natural', [60, 120, 110], 4_000), [0, 5_400, 5_050])
    // calm: 1.3 + 8.6 = 9.9 s, the third wait is cut to the 15 s cap (5.1 s instead of 8.05 s).
    assert.deepEqual(simulate('calm', [60, 120, 110], 4_000), [1_300, 8_600, 5_100])
    // With a fast model (1 s): natural 2.3 / 5.4 / 5.05 s.
    assert.deepEqual(simulate('natural', [60, 120, 110], 1_000), [2_300, 5_400, 5_050])
  })
  it('never more than 15 s of pacing per turn', () => {
    const waits = simulate('calm', [500, 500, 500], 0, 0)
    assert.equal(waits.reduce((a, b) => a + b, 0), MAX_TURN_PACING_MS)
    assert.equal(
      planPartWait({ pace: 'calm', index: 2, chars: 500, now: T0, spentMs: 0, pacedSoFarMs: MAX_TURN_PACING_MS, deadlineAt: DEADLINE }).waitMs,
      0,
    )
  })
  it('short budget left: the wait shrinks to 0; past the deadline later messages go as one (late)', () => {
    const near = DEADLINE - PACE_DEADLINE_RESERVE_MS - 1_000
    assert.deepEqual(planPartWait({ pace: 'natural', index: 1, chars: 120, now: near, spentMs: 0, pacedSoFarMs: 0, deadlineAt: DEADLINE }), { waitMs: 0, late: false })
    assert.deepEqual(planPartWait({ pace: 'natural', index: 0, chars: 120, now: DEADLINE + 5, spentMs: 0, pacedSoFarMs: 0, deadlineAt: DEADLINE }), { waitMs: 0, late: false })
    for (const pace of ['instant', 'natural', 'calm'] as const) {
      assert.deepEqual(planPartWait({ pace, index: 1, chars: 10, now: DEADLINE - 100, spentMs: 0, pacedSoFarMs: 0, deadlineAt: DEADLINE }), { waitMs: 0, late: true })
    }
    // A model that took 30 s: no pacing at all, nothing late before the deadline.
    const late = simulate('calm', [60, 120, 110], 30_000)
    assert.ok(late.every((w) => w === 0 || w === -1))
  })
})

describe('agents2-pace: setting (salesRules.replyPace)', () => {
  it('default natural; unknown / missing stored values read as natural; strict schema for the PUT', () => {
    assert.equal(DEFAULT_REPLY_PACE, 'natural')
    assert.equal(parseReplyPace(undefined), 'natural')
    assert.equal(parseReplyPace('turbo'), 'natural')
    assert.equal(parseReplyPace('calm'), 'calm')
    assert.equal(replyPaceSchema.safeParse('turbo').success, false)
    assert.equal(replyPaceSchema.safeParse('instant').success, true)
    assert.deepEqual(REPLY_PACE_OPTIONS.map((o) => o.label), ['Al instante', 'Natural', 'Pausado'])
    assert.match(paceNoteText('natural'), /En WhatsApp se envía con ritmo Natural \(~\d+ s entre mensajes\)/)
  })
  it('parseSalesRules keeps it (old rows → natural)', async () => {
    const { parseSalesRules, EMPTY_SALES_RULES } = await import('@/lib/soft-ai/agent-sales-setup')
    assert.equal(parseSalesRules({}).replyPace, 'natural')
    assert.equal(parseSalesRules({ replyPace: 'instant' }).replyPace, 'instant')
    assert.equal(parseSalesRules({ replyPace: 'x' }).replyPace, 'natural')
    assert.equal(EMPTY_SALES_RULES.replyPace, 'natural')
  })
  it('route + UI (source): own PUT branch, zod-validated, audited; 3-option control in ④ Probar y activar', () => {
    const route = read('src/app/api/chat/agents/[id]/settings/route.ts')
    assert.match(route, /if \('replyPace' in body\) \{\s*const parsed = replyPaceSchema\.safeParse\(body\.replyPace\)/)
    assert.match(route, /saveSalesSetup\(auth\.tenantId, agent\.id, \{ salesRules: \{ replyPace: value \} \}, auth\.userId\)/)
    assert.match(route, /description: 'Velocidad de respuesta del agente'/)
    assert.match(route, /replyPace: sales\?\.salesRules\.replyPace \?\? DEFAULT_REPLY_PACE/)
    const page = read('src/app/config/agentes/page.tsx')
    assert.match(page, /<AgentReplyPaceToggle key=\{`pace-\$\{selected\.id\}`\} agentId=\{selected\.id\} canEdit=\{canEdit\} \/>/)
  })
})

describe('agents2-pace: live loop only (source)', () => {
  const turn = read('src/lib/soft-ai/agent-turn.ts')
  it('the live send loop paces, re-checks the gates after each wait, and re-runs go out at once', () => {
    assert.match(turn, /const paceSetup = textAlreadyClaimed \? \{ pace: 'instant' as const, typing: false \} : await loadPaceSetup\(input\.row\.tenantId, input\.agent\.id\)/)
    assert.match(turn, /const wait = planPartWait\(\{/)
    // F2 / INT-123: after every wait a person's reply also stops (first part = skip, later parts = partial).
    assert.match(
      turn,
      /pacedSoFarMs \+= wait\.waitMs\s*\/\/ Gate re-check after the wait[\s\S]{0,200}pacedFirstPartStop\(input\.row\.tenantId, input\.row\.conversationId, input\.trigger\.sentAt\)[\s\S]{0,300}\} else if \(\s*\(await stopRemainingParts\(input\.row\.tenantId, input\.row\.conversationId\)\) \|\|\s*\(await humanRepliedSinceTrigger\(input\.row\.conversationId, input\.trigger\.sentAt\)\)\s*\) \{\s*partial = true\s*break/,
    )
    assert.match(turn, /if \(await hasHumanRepliedAfter\(\{ conversationId, triggerSentAt \}\)\) return 'human_replied'/)
    // F3: a read error after the wait is never a silent drop (the reply goes out; gates passed seconds before).
    assert.match(turn, /async function pacedFirstPartStop[\s\S]{0,900}\} catch \(error\) \{\s*console\.error\('\[soft-ai pace recheck\]'[^\n]*\n\s*return null\s*\}/)
    assert.doesNotMatch(turn, /pace_recheck_failed/)
    assert.match(turn, /lastSentAt = Date\.now\(\)/)
    assert.match(turn, /let lastSentAt = input\.trigger\.sentAt\.getTime\(\)/)
  })
  it('Probar and the quick check never wait', () => {
    const start = turn.indexOf('async function runAgentTestTurnInner(')
    const end = turn.indexOf('type ProbarInput')
    assert.ok(start > 0 && end > start)
    const probar = turn.slice(start, end)
    assert.doesNotMatch(probar, /setTimeout|planPartWait|sendWhatsappTypingIndicator|loadPaceSetup/)
    const run = read('src/lib/soft-ai/test-engine/run.ts')
    assert.doesNotMatch(run, /reply-pace|planPartWait|typing-indicator/)
    const sandbox = read('src/app/config/agentes/AgentTestSandbox.tsx')
    assert.match(sandbox, /paceNoteText\(replyPace\)/)
    assert.doesNotMatch(sandbox, /planPartWait|typingDelayMs/)
  })
  it('typing indicator: WhatsApp only, not instant, best effort (never throws, 2 s cap), wamid only', () => {
    assert.match(turn, /const showTyping = replyPace !== 'instant' && platform === 'whatsapp' && paceSetup\.typing/)
    // Extra (a): per-agent "Mostrar 'escribiendo…' en WhatsApp", default on.
    assert.match(turn, /typing: rules\.typingIndicator !== false/)
    const route = read('src/app/api/chat/agents/[id]/settings/route.ts')
    assert.match(route, /if \('typingIndicator' in body\) \{\s*if \(typeof body\.typingIndicator !== 'boolean'\)/)
    assert.match(read('src/app/config/agentes/AgentReplyPaceToggle.tsx'), /Mostrar “escribiendo…” en WhatsApp[\s\S]{0,120}Marca el mensaje como leído \(✓✓ azul\)/)
    assert.match(turn, /if \(showTyping\) \{\s*await sendWhatsappTypingIndicator\(\{ accessToken, phoneNumberId: account\.accountId, inboundMessageId: input\.trigger\.providerMessageId \}\)/)
    // The wait is measured from before the indicator call: the indicator never adds time.
    assert.match(turn, /const waitUntil = now \+ wait\.waitMs/)
    const ind = read('src/lib/soft-ai/typing-indicator.ts')
    assert.match(ind, /signal: AbortSignal\.timeout\(TYPING_INDICATOR_TIMEOUT_MS\)/)
    assert.match(ind, /\} catch \{\s*return false\s*\}/)
    assert.match(ind, /typing_indicator: \{ type: 'text' \}/)
    assert.match(ind, /status: 'read'/)
    assert.match(ind, /WAMID_RE\.test\(opts\.inboundMessageId\)/)
    assert.match(read('src/lib/soft-ai/reply-pace.ts'), /TYPING_INDICATOR_TIMEOUT_MS = 2_000/)
  })
})

describe('agents2-pace: quick check "why" + technical retry', () => {
  it('codes from the turn', () => {
    assert.deepEqual(
      probarOutcomeCodes({ validationReasons: ['unsourced_amount'], policyReasons: ['foreign_link'], errorCode: null, escalate: false, escalateReason: 'provenance', handoff: { kind: 'review', reason: 'review' } }),
      ['unsourced_amount', 'foreign_link', 'review'],
    )
    assert.deepEqual(probarOutcomeCodes({ errorCode: 'XAI_TIMEOUT', handoff: { kind: 'review', reason: 'review' } }), ['XAI_TIMEOUT', 'review'])
    assert.deepEqual(probarOutcomeCodes({ escalate: true, escalateReason: 'human_requested', handoff: { kind: 'handoff', reason: 'human_request' } }), ['escalate:human_requested'])
  })
  it('plain Spanish', () => {
    assert.equal(caseWhy(['unsourced_amount', 'review']), 'El agente mencionó un monto que no está en los datos')
    assert.equal(caseWhy(['foreign_link']), 'Puso un enlace que no es de la tienda')
    assert.equal(caseWhy(['XAI_TIMEOUT', 'review']), 'La IA tardó demasiado en responder')
    assert.equal(caseWhy(['LLM_ERROR']), 'Error de la IA (proveedor)')
    assert.equal(caseWhy(['escalate:human_requested']), 'Pasó a una persona: pidió una persona')
    assert.equal(caseWhy(['review']), 'Respondió con la frase de respaldo: su respuesta no pasó las reglas')
    assert.equal(caseWhy(['payment_number_unsourced', 'style_too_long', 'write_claim']), 'Dio un número de pago que no está en los datos · La respuesta fue demasiado larga')
    assert.equal(caseWhy([]), null)
    assert.equal(caseWhy(['shortened']), null)
    assert.equal(caseWhy([], 'test_budget_blocked'), 'Se acabó el límite diario de pruebas')
  })
  it('retry only a failure that is technical ONLY, once, within the cost cap', () => {
    assert.equal(isTechnicalOnlyFailure(['XAI_TIMEOUT', 'review']), true)
    assert.equal(isTechnicalOnlyFailure(['LLM_ERROR', 'escalate:llm_unavailable']), true)
    assert.equal(isTechnicalOnlyFailure(['unsourced_amount', 'review']), false)
    assert.equal(isTechnicalOnlyFailure(['XAI_TIMEOUT', 'foreign_link']), false)
    assert.equal(isTechnicalOnlyFailure(['LLM_AUTH']), false)
    assert.equal(isTechnicalOnlyFailure([]), false)
    const failed = { pass: false, error: null, codes: ['XAI_TIMEOUT', 'review'] }
    assert.equal(shouldRetryCase(failed, 0, 400_000), true)
    assert.equal(shouldRetryCase({ ...failed, pass: true }, 0, 400_000), false)
    assert.equal(shouldRetryCase({ ...failed, retried: true }, 0, 400_000), false)
    assert.equal(shouldRetryCase({ ...failed, error: 'test_budget_blocked' }, 0, 400_000), false)
    assert.equal(shouldRetryCase(failed, 400_000, 400_000), false)
    assert.equal(shouldRetryCase({ ...failed, codes: ['write_claim'] }, 0, 400_000), false)
    // INT-124: no retry once the leased step's time is used up; a timed-out attempt is charged an estimate.
    assert.equal(shouldRetryCase(failed, 0, 400_000, 5_000), true)
    assert.equal(shouldRetryCase(failed, 0, 400_000, 0), false)
    assert.equal(shouldRetryCase(failed, 0, 400_000, -1), false)
    assert.equal(attemptCostMicros(['XAI_TIMEOUT', 'review'], 0), TIMEOUT_ATTEMPT_COST_MICROS)
    assert.equal(attemptCostMicros(['XAI_TIMEOUT'], 90_000), 90_000)
    assert.equal(attemptCostMicros(['unsourced_amount'], 1_234), 1_234)
  })
  it('run.ts stores why / codes / retried; the UI shows why under a failed case', () => {
    const run = read('src/lib/soft-ai/test-engine/run.ts')
    assert.match(run, /first\.costMicros = attemptCostMicros\(first\.result\.codes \?\? \[\], first\.costMicros\)/)
    assert.match(run, /if \(!shouldRetryCase\(first\.result, run\.spentMicros \+ first\.costMicros, run\.costCapMicros, STEP_BUDGET_MS - \(Date\.now\(\) - stepStarted\)\)\) \{\s*return first/)
    // INT-124: the lease is refreshed before the retry, only while this worker still owns the cursor.
    assert.match(run, /SET "leaseUntil" = NOW\(\)[^\n]*\n\s*WHERE "id" = \$\{run\.id\} AND "tenantId" = \$\{run\.tenantId\} AND "status" = 'running' AND "cursor" = \$\{run\.cursor\}`\s*if \(leased === 0\) return first/)
    assert.match(run, /runCase\(run, tc, started\)/)
    assert.match(run, /if \(second\.result\.error\) return \{ result: first\.result, costMicros \}/)
    assert.match(run, /retried: true/)
    assert.match(run, /why: caseWhy\(codes\), codes/)
    for (const f of ['src/app/config/agentes/AgentActivationCard.tsx', 'src/app/config/agentes/ChannelsEditor.tsx']) {
      assert.match(read(f), /\{!r\.pass && r\.why \? <p[^>]*data-testid="case-why">Por qué: \{r\.why\}/)
    }
    assert.match(read('src/lib/soft-ai/agent-status-server.ts'), /why: typeof x\.why === 'string' \? x\.why\.slice\(0, 300\) : null/)
    // Burst = one reply (2026-10-17): Probar also shows the review live would raise after the reply.
    assert.match(read('src/lib/soft-ai/agent-turn.ts'), /codes: probarOutcomeCodes\(\{ validationReasons, policyReasons, errorCode: llmErrorCode, escalate, escalateReason, handoff: handoff \?\? probarBurstReview \}\)/)
  })
})

describe('agents2-pace F1: the next message of the same chat is not left for the cron', () => {
  const proc = read('src/lib/soft-ai/automation-processor.ts')
  it('after complete / fail, the newest waiting job of the same conversation (tenant-scoped) is kicked once', () => {
    assert.match(proc, /export async function kickNextConversationJob\(/)
    assert.match(proc, /where: \{\s*tenantId: row\.tenantId,\s*conversationId: row\.conversationId,\s*id: \{ not: row\.id \},\s*status: \{ in: \['pending', 'retry'\] \},\s*availableAt: \{ lte: new Date\(\) \},/)
    assert.match(proc, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
    // One kick, no chain: the kicked job runs with kick: false — except a job that yielded to a newer burst bubble
    // (burst = one reply, 2026-10-17), which always hands over (bounded: it yields only while a newer job is queued).
    assert.match(proc, /if \(next\) void processJobById\(next\.id, \{ kick: false \}\)\.catch\(\(\) => undefined\)/)
    assert.match(proc, /await completeJob\(row\)[\s\S]{0,400}const superseded = result\?\.status === 'skipped' && 'reason' in result && result\.reason === 'superseded'\s*if \(kick \|\| superseded\) void kickNextConversationJob\(row\)/)
    // Not after a timeout (that turn may still be sending in the background).
    assert.match(proc, /if \(kick && !timedOut\) void kickNextConversationJob\(row\)/)
    // Best effort: never throws.
    assert.match(proc, /export async function kickNextConversationJob[\s\S]{0,900}\} catch \{\s*\/\* the cron picks it up \*\/\s*\}/)
    assert.match(proc, /export async function processJobById\(id: string, opts\?: \{ kick\?: boolean \}\)/)
  })
})
