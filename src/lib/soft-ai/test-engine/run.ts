/**
 * Agent test runs (SQL 050 "ChatAgentTestRun"): generate the agent's suite, run every case through the real
 * Probar path (sandbox — no order, stock, guía or Meta send), grade it, and store the result. Processed in small
 * leased steps so a restart or the chat-automation cron can resume a run. Cost-capped.
 */
import 'server-only'

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { agentHasInventoryMap, loadMappedInventoryIds } from '@/lib/soft-ai/agent-inventory-map'
import { canSharePaymentFacts, parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { loadAgentSalesContext } from '@/lib/soft-ai/agent-sales-context'
import { salesAllowedAmounts } from '@/lib/soft-ai/sales-state'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { readChatAgentLayerConfig } from '@/lib/feature-flags'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { resolveSoftAiModel, softAiResponsesCreate, parseSoftAiResponseText, readSoftAiUsage } from '@/lib/soft-ai/llm/client'
import { estimateCostMicros } from '@/lib/soft-ai/llm/usage'
import { generateAgentSuite, selectQuickSuite, type TestCase } from '@/lib/soft-ai/test-engine/generate'
import {
  gradeRuleCase,
  judgePrompt,
  JUDGE_INSTRUCTIONS,
  JUDGE_SCHEMA,
  parseJudge,
  summarize,
  type SuiteSummary,
  type TurnForGrading,
} from '@/lib/soft-ai/test-engine/grade'
import { caseWhy, shouldRetryCase } from '@/lib/soft-ai/test-engine/why'

const TABLE = 'ChatAgentTestRun'
export const TEST_RUN_COST_CAP_MICROS = 400_000 // US$0.40 per run
/** Per business per UTC day: at most this many runs and this much spend (runs + their grader calls). */
export const TEST_RUNS_PER_DAY = 20
export const TEST_RUN_DAILY_SPEND_MICROS = 3_000_000 // US$3
const LEASE_MS = 120_000
const STEP_BUDGET_MS = 25_000

export type TestRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cost_capped' | 'canceled' | 'error'

export type CaseResult = {
  id: string
  title: string
  group: TestCase['group']
  grading: 'rule' | 'judge'
  pass: boolean
  reply: string
  notes: string[]
  error?: string | null
  /** agents2-pace: why the agent did not answer normally (validator / AI timeout / hand-off), plain Spanish. */
  why?: string | null
  /** The raw outcome codes behind `why` (validator reasons, provider error code, escalate:<reason>, review). */
  codes?: string[]
  /** The case failed only for a technical reason on the first try and was run once more. */
  retried?: boolean
}

export type TestRunRow = {
  id: string
  tenantId: string
  agentId: string
  socialAccountId: string
  model: string
  agentVersion: number
  suiteHash: string
  status: TestRunStatus
  cases: TestCase[]
  results: CaseResult[]
  cursor: number
  costCapMicros: number
  spentMicros: number
  summary: SuiteSummary | null
  /**
   * The one switch's 6-case check (its cases carry `quick: true`). A quick run IS the "turn the line on when it
   * passes" intent; its actor is createdBy. No new SQL, nothing stored in the layer config.
   */
  quick: boolean
  /** Outcome of the automatic activation after a green quick run (summary.activation; set by finish()). */
  activation: RunActivationResult | null
  createdBy: string
  createdAt: Date
  finishedAt: Date | null
}

export type RunActivationResult = { ok: boolean; code: string | null; at: string }

export function parseRunActivation(raw: unknown): RunActivationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.ok !== 'boolean') return null
  return { ok: r.ok, code: typeof r.code === 'string' ? r.code : null, at: typeof r.at === 'string' ? r.at : '' }
}

/** Pure: a run whose cases are the quick suite (generate.ts marks them). */
export function isQuickRunCases(cases: unknown): boolean {
  return Array.isArray(cases) && cases.length > 0 && cases.every((c) => Boolean(c && typeof c === 'object' && (c as { quick?: unknown }).quick === true))
}

export class TestRunDailyLimitError extends Error {
  constructor() {
    super('TEST_RUN_DAILY_LIMIT')
    this.name = 'TestRunDailyLimitError'
  }
}

/** The suite cannot finish inside today's test budget: refused before any model call (nothing spent). */
export class TestRunBudgetError extends Error {
  constructor(readonly remainingTokens: number, readonly neededTokens: number, readonly capTokens: number) {
    super('TEST_RUN_BUDGET')
    this.name = 'TestRunBudgetError'
  }
}

/** Typical test-turn size when this agent has none recently (system prompt + knowledge + reply, Grok, 2026-10). */
export const TEST_TURN_TOKENS_FALLBACK = 9_000

/**
 * Test-budget tokens a run of `cases` must find free to finish: the per-turn gate (agent-turn.ts) only checks the
 * budget BEFORE each turn, so the last case may still start just under the cap → (cases − 1) × this agent's
 * average test turn. Grader calls are metered as AI usage, not against this budget. Pure (exported for tests).
 */
export function estimateRunTokens(cases: number, recentTurnTokens: number[]): number {
  const real = recentTurnTokens.filter((t) => t > 0)
  const perTurn = real.length ? Math.ceil(real.reduce((a, b) => a + b, 0) / real.length) : TEST_TURN_TOKENS_FALLBACK
  return Math.max(0, cases - 1) * perTurn
}

export class TestRunBusyElsewhereError extends Error {
  constructor() {
    super('TEST_RUN_BUSY_ELSEWHERE')
    this.name = 'TestRunBusyElsewhereError'
  }
}

/** An agent that searches products but has none chosen cannot sell: no green tests for it (they had no price cases). */
export class TestRunNoProductsError extends Error {
  constructor() {
    super('TEST_RUN_NO_PRODUCTS')
    this.name = 'TestRunNoProductsError'
  }
}

export class TestRunNotReadyError extends Error {
  constructor() {
    super('TEST_RUN_NOT_READY')
    this.name = 'TestRunNotReadyError'
  }
}

function mapRow(r: Record<string, unknown>): TestRunRow {
  return {
    id: String(r.id),
    tenantId: String(r.tenantId),
    agentId: String(r.agentId),
    socialAccountId: String(r.socialAccountId),
    model: String(r.model),
    agentVersion: Number(r.agentVersion),
    suiteHash: String(r.suiteHash),
    status: String(r.status) as TestRunStatus,
    cases: (Array.isArray(r.cases) ? r.cases : []) as TestCase[],
    results: (Array.isArray(r.results) ? r.results : []) as CaseResult[],
    cursor: Number(r.cursor || 0),
    costCapMicros: Number(r.costCapMicros || 0),
    spentMicros: Number(r.spentMicros || 0),
    summary: (r.summary as SuiteSummary | null) ?? null,
    quick: isQuickRunCases(r.cases),
    activation: parseRunActivation((r.summary as { activation?: unknown } | null)?.activation),
    createdBy: String(r.createdBy),
    createdAt: r.createdAt as Date,
    finishedAt: (r.finishedAt as Date | null) ?? null,
  }
}

async function loadRun(tenantId: string, id: string): Promise<TestRunRow | null> {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentTestRun" WHERE "id" = ${id} AND "tenantId" = ${tenantId} LIMIT 1`
  return rows[0] ? mapRow(rows[0]) : null
}

/** Latest run of this agent on this channel (any status). */
export async function latestTestRun(tenantId: string, agentId: string, socialAccountId?: string | null) {
  if (!(await isTableReady(TABLE))) return null
  try {
    const rows = socialAccountId
      ? await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT * FROM "ChatAgentTestRun"
           WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "socialAccountId" = ${socialAccountId}
           ORDER BY "createdAt" DESC LIMIT 1`
      : await prisma.$queryRaw<Array<Record<string, unknown>>>`
          SELECT * FROM "ChatAgentTestRun"
           WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}
           ORDER BY "createdAt" DESC LIMIT 1`
    return rows[0] ? mapRow(rows[0]) : null
  } catch (error) {
    if (isMissingRelation(error)) return null
    throw error
  }
}

/** Builds the suite from THIS agent's data only (its mapped products, its payment facts, its instructions). */
export async function buildSuite(tenantId: string, agent: { id: string; name: string; systemInstructions: string; brandFacts: unknown }) {
  const mapped = (await loadMappedInventoryIds(tenantId, agent.id)) ?? []
  const products = mapped.length
    ? await prisma.inventoryItem.findMany({
        where: { tenantId, id: { in: mapped }, isActive: true },
        select: { name: true, sellingPrice: true, currentStock: true },
        orderBy: { name: 'asc' },
        take: 50,
      })
    : []
  const foreign = mapped.length
    ? await prisma.inventoryItem.findFirst({
        where: { tenantId, isActive: true, id: { notIn: mapped }, sellingPrice: { gt: 0 } },
        select: { name: true, sellingPrice: true },
        orderBy: { name: 'asc' },
      })
    : null
  const facts = parseBrandFactsSafe(agent.brandFacts)
  // The grader sees the same selling data the agent sees (shipping, combos, allowed amounts) — 2026-10-15 quick check.
  // V4: no catch — a load failure must fail the run clearly, never build a different suite (and hash) silently.
  // An agent without a sales setup still gets a context (loadAgentSalesContext falls back to empty lists).
  const salesCtx = await loadAgentSalesContext({ tenantId, agentId: agent.id, inventoryItemIds: mapped, brandFacts: facts, strict: true })
  return generateAgentSuite({
    agentName: agent.name,
    systemInstructions: agent.systemInstructions || '',
    products: products.map((p) => ({ name: p.name, sellingPrice: Number(p.sellingPrice), currentStock: Number(p.currentStock) })),
    foreignProduct: foreign ? { name: foreign.name, sellingPrice: Number(foreign.sellingPrice) } : null,
    payment: {
      shareable: canSharePaymentFacts(facts),
      // Only when SINPE is an offered method — the same rule [[PAGO_SINPE]] uses (payment-guard methodAvailable).
      sinpeNumber: (facts.payment?.methods ?? []).includes('sinpe') ? facts.payment?.sinpe?.number ?? null : null,
    },
    sales: salesCtx
      ? {
          shipping: salesCtx.shippingMethods.map((s) => ({ name: s.name, price: s.price })),
          bundles: (salesCtx.bundles ?? []).map((b) => ({ name: b.name, price: b.price, shippingIncluded: b.shippingIncluded })),
          allowedAmounts: salesAllowedAmounts(salesCtx),
        }
      : null,
  })
}

/** Start (or return the already-active) run for this agent on this channel. Kicks processing in the background. */
export async function startAgentTestRun(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  userId: string
  /** The one switch's 6-case check (selectQuickSuite): when it passes, the line turns on by itself. */
  quick?: boolean
}): Promise<TestRunRow> {
  if (!(await isTableReady(TABLE))) throw new TestRunNotReadyError()
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, name: true, systemInstructions: true, brandFacts: true, model: true, version: true, enabledTools: true },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  if (agent.enabledTools.includes('search_inventory') && (await agentHasInventoryMap(input.tenantId, agent.id)) !== true) {
    throw new TestRunNoProductsError()
  }
  // Daily limit per business (runs and spend, grader calls included): test runs use Betsy's AI keys.
  const today = await prisma.$queryRaw<Array<{ runs: bigint; spent: bigint | null }>>`
    SELECT COUNT(*)::bigint AS "runs", COALESCE(SUM("spentMicros"), 0)::bigint AS "spent"
      FROM "ChatAgentTestRun"
     WHERE "tenantId" = ${input.tenantId} AND "createdAt" >= date_trunc('day', NOW() AT TIME ZONE 'UTC')`
  const runsToday = Number(today[0]?.runs ?? 0)
  const spentToday = Number(today[0]?.spent ?? 0)
  const active = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentTestRun"
     WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${agent.id} AND "status" IN ('queued', 'running')
     LIMIT 1`
  if (active[0]) {
    const run = mapRow(active[0])
    if (run.socialAccountId !== input.socialAccountId) throw new TestRunBusyElsewhereError()
    void drainAgentTestRun(run.tenantId, run.id)
    return run
  }
  if (runsToday >= TEST_RUNS_PER_DAY || spentToday >= TEST_RUN_DAILY_SPEND_MICROS) throw new TestRunDailyLimitError()
  const full = await buildSuite(input.tenantId, {
    id: agent.id,
    name: agent.name,
    systemInstructions: agent.systemInstructions,
    brandFacts: (agent as { brandFacts?: unknown }).brandFacts,
  })
  const { cases, suiteHash } = input.quick ? selectQuickSuite(full) : full
  // Never start a run that the daily test budget cannot finish: a half run spends money and still can't activate.
  const [usedTokens, layer, recent] = await Promise.all([
    loadDailyTestTokens(input.tenantId),
    readChatAgentLayerConfig(input.tenantId).then((f) => parseChatAgentLayerConfig(f.config)),
    prisma.chatAgentTurn.findMany({
      where: { tenantId: input.tenantId, agentId: agent.id, mode: 'test', createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { inputTokens: true, outputTokens: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])
  const needed = estimateRunTokens(cases.length, recent.map((t) => (t.inputTokens || 0) + (t.outputTokens || 0)))
  const remaining = Math.max(0, layer.testDailyTokenCap - usedTokens)
  if (needed > remaining) throw new TestRunBudgetError(remaining, needed, layer.testDailyTokenCap)
  const id = randomUUID()
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChatAgentTestRun"
        ("id", "tenantId", "agentId", "socialAccountId", "model", "agentVersion", "suiteHash", "status", "cases",
         "results", "cursor", "costCapMicros", "spentMicros", "createdBy")
      VALUES (${id}, ${input.tenantId}, ${agent.id}, ${input.socialAccountId}, ${agent.model}, ${agent.version},
              ${suiteHash}, 'queued', ${JSON.stringify(cases)}::jsonb, '[]'::jsonb, 0, ${TEST_RUN_COST_CAP_MICROS},
              0, ${input.userId})`
  } catch (error) {
    // Partial unique index: someone started one at the same time — return that one.
    const again = await latestTestRun(input.tenantId, agent.id)
    if (again && (again.status === 'queued' || again.status === 'running')) return again
    throw error
  }
  void drainAgentTestRun(input.tenantId, id)
  const run = await loadRun(input.tenantId, id)
  if (!run) throw new Error('TEST_RUN_MISSING')
  return run
}

async function judge(
  tc: TestCase,
  turn: TurnForGrading,
  rubric: string,
  ctx: { tenantId: string; agentId: string; model: string; cost: { micros: number } },
  facts?: string,
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await softAiResponsesCreate({
        model: resolveSoftAiModel(ctx.model),
        instructions: JUDGE_INSTRUCTIONS,
        input: [{ type: 'message', role: 'user', content: judgePrompt(tc, turn, rubric, facts) }],
        store: false,
        temperature: 0,
        reasoningEffort: 'low',
        // Reasoning models spend part of the cap on reasoning: leave room for the short JSON verdict.
        maxOutputTokens: 900,
        timeoutMs: 15_000,
        textFormat: { name: 'agent_test_verdict', schema: JUDGE_SCHEMA as unknown as Record<string, unknown> },
        usage: { tenantId: ctx.tenantId, feature: 'agent_test', agentId: ctx.agentId },
      })
      const used = readSoftAiUsage(response)
      ctx.cost.micros += estimateCostMicros({
        model: ctx.model,
        inputTokens: used.inputTokens,
        cachedInputTokens: used.cachedInputTokens,
        outputTokens: used.outputTokens,
      })
      const verdict = parseJudge(parseSoftAiResponseText(response))
      // A judged case that fails once is re-judged (LLM graders are noisy); two fails = fail.
      if (verdict?.pass) return verdict
      if (verdict && attempt === 1) return verdict
    } catch {
      if (attempt === 1) return { pass: false, reason: 'No se pudo evaluar.' }
    }
  }
  return { pass: false, reason: 'No se pudo evaluar.' }
}

/**
 * One case. A case that failed ONLY for a technical reason (AI timeout / provider error, no validator rejection) is
 * run once more before it counts (shouldRetryCase: within the run's cost cap; the test budget is re-checked by the
 * turn itself). If the retry is blocked or errors, the first result stands.
 */
async function runCase(run: TestRunRow, tc: TestCase): Promise<{ result: CaseResult; costMicros: number }> {
  const first = await runCaseOnce(run, tc)
  if (!shouldRetryCase(first.result, run.spentMicros + first.costMicros, run.costCapMicros)) return first
  const second = await runCaseOnce(run, tc)
  const costMicros = first.costMicros + second.costMicros
  if (second.result.error) return { result: first.result, costMicros }
  return { result: { ...second.result, retried: true }, costMicros }
}

async function runCaseOnce(run: TestRunRow, tc: TestCase): Promise<{ result: CaseResult; costMicros: number }> {
  let turn: TurnForGrading
  let codes: string[] = []
  let costMicros = 0
  for (let attempt = 0; ; attempt += 1) {
    try {
      const out = await runAgentTestTurn({
        tenantId: run.tenantId,
        agentId: run.agentId,
        inboundText: tc.message,
        socialAccountId: run.socialAccountId,
        actorUserId: run.createdBy,
        testSessionId: `run:${run.id}:${tc.id}`,
        windowOpen: true,
        conversationAiMode: 'ai_active',
        ignoreLayerFlag: true,
        usageFeature: 'agent_test',
      })
      costMicros = Math.round((out.estimatedCostUsd || 0) * 1_000_000)
      // A blocked test turn is not an agent answer: stop the run with a plain reason instead of grading silence.
      const blocked = (out.blockedBy || []).find((b) => b === 'test_budget_blocked' || b === 'not_bound_to_channel')
      if (blocked) {
        return {
          result: { id: tc.id, title: tc.title, group: tc.group, grading: tc.grading, pass: false, reply: '', notes: [], error: blocked, why: caseWhy([], blocked), codes: [blocked] },
          costMicros,
        }
      }
      turn = { text: out.text || '', escalate: out.escalate, needsHuman: out.needsHuman, outcome: out.outcome }
      codes = Array.isArray(out.codes) ? out.codes : []
      break
    } catch (error) {
      const code = error instanceof Error ? error.message : 'error'
      if (code === 'PROBAR_BUSY' && attempt < 10) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      return {
        result: { id: tc.id, title: tc.title, group: tc.group, grading: tc.grading, pass: false, reply: '', notes: [], error: code.slice(0, 60), why: caseWhy([], code.slice(0, 60)), codes: [] },
        costMicros,
      }
    }
  }
  const rule = gradeRuleCase(tc, turn)
  const notes = rule.checks.filter((c) => !c.pass && c.note).map((c) => c.note as string)
  let pass = rule.pass
  if (tc.grading === 'judge') {
    const rubric = tc.expect.find((e) => e.kind === 'judge')
    if (rubric && rubric.kind === 'judge') {
      const cost = { micros: 0 }
      const verdict = await judge(tc, turn, rubric.rubric, { tenantId: run.tenantId, agentId: run.agentId, model: run.model, cost }, rubric.facts)
      costMicros += cost.micros
      pass = pass && verdict.pass
      if (!verdict.pass && verdict.reason) notes.push(verdict.reason)
    }
  }
  return {
    result: { id: tc.id, title: tc.title, group: tc.group, grading: tc.grading, pass, reply: turn.text.slice(0, 600), notes, error: null, why: caseWhy(codes), codes },
    costMicros,
  }
}

/** Process a run in a leased step (resumable). Never throws. */
export async function drainAgentTestRun(tenantId: string, id: string): Promise<void> {
  try {
    const claimed = await prisma.$executeRaw`
      UPDATE "ChatAgentTestRun"
         SET "status" = 'running', "leaseUntil" = NOW() + (${LEASE_MS}::int * INTERVAL '1 millisecond')
       WHERE "id" = ${id} AND "tenantId" = ${tenantId}
         AND ("status" = 'queued' OR ("status" = 'running' AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())))`
    if (claimed === 0) return
    const started = Date.now()
    let run: TestRunRow | null = await loadRun(tenantId, id)
    if (!run) return
    while (run.cursor < run.cases.length) {
      if (Date.now() - started > STEP_BUDGET_MS) {
        // Hand the rest to the next tick (cron) or a later call.
        await prisma.$executeRaw`UPDATE "ChatAgentTestRun" SET "leaseUntil" = NULL WHERE "id" = ${id} AND "tenantId" = ${tenantId}`
        return
      }
      if (run.spentMicros >= run.costCapMicros) {
        await finish(run, 'cost_capped')
        return
      }
      const tc = run.cases[run.cursor]
      const { result, costMicros } = await runCase(run, tc)
      const results: CaseResult[] = [...run.results, result]
      // Cursor guard: if another worker already advanced this run (expired lease), stop — never double-process.
      const advanced = await prisma.$executeRaw`
        UPDATE "ChatAgentTestRun"
           SET "results" = ${JSON.stringify(results)}::jsonb, "cursor" = ${run.cursor + 1},
               "spentMicros" = "spentMicros" + ${costMicros},
               "leaseUntil" = NOW() + (${LEASE_MS}::int * INTERVAL '1 millisecond')
         WHERE "id" = ${id} AND "tenantId" = ${tenantId} AND "status" = 'running' AND "cursor" = ${run.cursor}`
      if (advanced === 0) return
      run = { ...run, results, cursor: run.cursor + 1, spentMicros: run.spentMicros + costMicros }
      if (result.error === 'test_budget_blocked' || result.error === 'not_bound_to_channel') {
        await finish(run, 'error')
        return
      }
    }
    const summary = summarize(run.results)
    await finish(run, summary.passed ? 'passed' : 'failed', summary)
  } catch (error) {
    console.error('[soft-ai/test-run]', error instanceof Error ? error.name : 'unknown')
    await prisma.$executeRaw`
      UPDATE "ChatAgentTestRun" SET "status" = 'error', "leaseUntil" = NULL, "finishedAt" = NOW()
       WHERE "id" = ${id} AND "tenantId" = ${tenantId} AND "status" IN ('queued', 'running')`.catch(() => {})
  }
}

async function finish(run: TestRunRow, status: TestRunStatus, summary?: SuiteSummary) {
  const s = summary ?? summarize(run.results)
  // Conditional: only the worker that moves the run out of 'running' acts on it (a run switched off meanwhile is
  // already 'canceled' and is left alone).
  const finished = await prisma.$executeRaw`
    UPDATE "ChatAgentTestRun"
       SET "status" = ${status}, "summary" = ${JSON.stringify(s)}::jsonb, "leaseUntil" = NULL, "finishedAt" = NOW()
     WHERE "id" = ${run.id} AND "tenantId" = ${run.tenantId} AND "status" = 'running'`
  if (finished === 0 || status !== 'passed' || !run.quick) return
  // A green quick run is the one switch's intent: turn the line on (activation re-checks everything).
  try {
    const { activateAfterQuickRun } = await import('@/lib/soft-ai/agent-activation')
    await activateAfterQuickRun({ ...run, status, summary: s })
  } catch (error) {
    console.error('[soft-ai/test-run] power-on', error instanceof Error ? error.name : 'unknown')
  }
}

/** Store the automatic activation outcome next to the run's summary (read by the line status). */
export async function recordRunActivation(tenantId: string, runId: string, result: { ok: boolean; code?: string | null }) {
  const value = JSON.stringify({ ok: result.ok, code: result.code ?? null, at: new Date().toISOString() })
  await prisma.$executeRaw`
    UPDATE "ChatAgentTestRun"
       SET "summary" = jsonb_set(COALESCE("summary", '{}'::jsonb), '{activation}', ${value}::jsonb, true)
     WHERE "id" = ${runId} AND "tenantId" = ${tenantId}`
}

/** Switching a line off cancels its queued/running checks: a run that would pass later never turns it back on. */
export async function cancelLineTestRuns(tenantId: string, agentId: string, socialAccountId: string): Promise<number> {
  if (!(await isTableReady(TABLE))) return 0
  return prisma.$executeRaw`
    UPDATE "ChatAgentTestRun"
       SET "status" = 'canceled', "leaseUntil" = NULL, "finishedAt" = NOW()
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "socialAccountId" = ${socialAccountId}
       AND "status" IN ('queued', 'running')`
}

/** Cron: resume runs whose lease expired (server restart, long run). At most a couple per tick. */
export async function drainStaleAgentTestRuns(limit = 2): Promise<number> {
  if (!(await isTableReady(TABLE))) return 0
  const rows = await prisma.$queryRaw<Array<{ id: string; tenantId: string }>>`
    SELECT "id", "tenantId" FROM "ChatAgentTestRun"
     WHERE "status" IN ('queued', 'running') AND ("leaseUntil" IS NULL OR "leaseUntil" < NOW())
     ORDER BY "createdAt" ASC LIMIT ${limit}`
  for (const r of rows) await drainAgentTestRun(r.tenantId, r.id)
  return rows.length
}
