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
import { loadMappedInventoryIds } from '@/lib/soft-ai/agent-inventory-map'
import { canSharePaymentFacts, parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { resolveSoftAiModel, softAiResponsesCreate, parseSoftAiResponseText } from '@/lib/soft-ai/llm/client'
import { generateAgentSuite, type TestCase } from '@/lib/soft-ai/test-engine/generate'
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

const TABLE = 'ChatAgentTestRun'
export const TEST_RUN_COST_CAP_MICROS = 400_000 // US$0.40 per run
const LEASE_MS = 90_000
const STEP_BUDGET_MS = 40_000

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
  createdBy: string
  createdAt: Date
  finishedAt: Date | null
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
async function buildSuite(tenantId: string, agent: { id: string; name: string; systemInstructions: string; brandFacts: unknown }) {
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
  return generateAgentSuite({
    agentName: agent.name,
    systemInstructions: agent.systemInstructions || '',
    products: products.map((p) => ({ name: p.name, sellingPrice: Number(p.sellingPrice), currentStock: Number(p.currentStock) })),
    foreignProduct: foreign ? { name: foreign.name, sellingPrice: Number(foreign.sellingPrice) } : null,
    payment: {
      shareable: canSharePaymentFacts(facts),
      sinpeNumber: facts.payment?.sinpe?.number ?? null,
    },
  })
}

/** Start (or return the already-active) run for this agent on this channel. Kicks processing in the background. */
export async function startAgentTestRun(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  userId: string
}): Promise<TestRunRow> {
  if (!(await isTableReady(TABLE))) throw new TestRunNotReadyError()
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, name: true, systemInstructions: true, brandFacts: true, model: true, version: true },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  const active = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT * FROM "ChatAgentTestRun"
     WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${agent.id} AND "status" IN ('queued', 'running')
     LIMIT 1`
  if (active[0]) {
    const run = mapRow(active[0])
    void drainAgentTestRun(run.tenantId, run.id)
    return run
  }
  const { cases, suiteHash } = await buildSuite(input.tenantId, {
    id: agent.id,
    name: agent.name,
    systemInstructions: agent.systemInstructions,
    brandFacts: (agent as { brandFacts?: unknown }).brandFacts,
  })
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

async function judge(tc: TestCase, turn: TurnForGrading, rubric: string, ctx: { tenantId: string; agentId: string; model: string }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await softAiResponsesCreate({
        model: resolveSoftAiModel(ctx.model),
        instructions: JUDGE_INSTRUCTIONS,
        input: [{ type: 'message', role: 'user', content: judgePrompt(tc, turn, rubric) }],
        store: false,
        temperature: 0,
        reasoningEffort: 'low',
        maxOutputTokens: 200,
        timeoutMs: 15_000,
        textFormat: { name: 'agent_test_verdict', schema: JUDGE_SCHEMA as unknown as Record<string, unknown> },
        usage: { tenantId: ctx.tenantId, feature: 'agent_test', agentId: ctx.agentId },
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

async function runCase(run: TestRunRow, tc: TestCase): Promise<{ result: CaseResult; costMicros: number }> {
  let turn: TurnForGrading
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
      })
      costMicros = Math.round((out.estimatedCostUsd || 0) * 1_000_000)
      turn = { text: out.text || '', escalate: out.escalate, needsHuman: out.needsHuman, outcome: out.outcome }
      break
    } catch (error) {
      const code = error instanceof Error ? error.message : 'error'
      if (code === 'PROBAR_BUSY' && attempt < 10) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      return {
        result: { id: tc.id, title: tc.title, group: tc.group, grading: tc.grading, pass: false, reply: '', notes: [], error: code.slice(0, 60) },
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
      const verdict = await judge(tc, turn, rubric.rubric, { tenantId: run.tenantId, agentId: run.agentId, model: run.model })
      pass = pass && verdict.pass
      if (!verdict.pass && verdict.reason) notes.push(verdict.reason)
    }
  }
  return {
    result: { id: tc.id, title: tc.title, group: tc.group, grading: tc.grading, pass, reply: turn.text.slice(0, 600), notes, error: null },
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
      await prisma.$executeRaw`
        UPDATE "ChatAgentTestRun"
           SET "results" = ${JSON.stringify(results)}::jsonb, "cursor" = ${run.cursor + 1},
               "spentMicros" = "spentMicros" + ${costMicros},
               "leaseUntil" = NOW() + (${LEASE_MS}::int * INTERVAL '1 millisecond')
         WHERE "id" = ${id} AND "tenantId" = ${tenantId} AND "status" = 'running'`
      run = { ...run, results, cursor: run.cursor + 1, spentMicros: run.spentMicros + costMicros }
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
  await prisma.$executeRaw`
    UPDATE "ChatAgentTestRun"
       SET "status" = ${status}, "summary" = ${JSON.stringify(s)}::jsonb, "leaseUntil" = NULL, "finishedAt" = NOW()
     WHERE "id" = ${run.id} AND "tenantId" = ${run.tenantId} AND "status" = 'running'`
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
