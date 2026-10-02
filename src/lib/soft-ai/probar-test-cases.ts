/**
 * Saved Probar tests (server). SQL 047; fail-safe when the table is missing. Every query is scoped by tenantId
 * and the agent is verified to belong to that tenant. Also stores the result of a full scenario run as an eval run.
 */
import 'server-only'

import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import {
  MAX_CASES_PER_AGENT,
  SCENARIO_SET_VERSION,
  parseSavedTest,
  type SavedTestInput,
  type ScenarioStep,
} from '@/lib/soft-ai/probar-scenarios'

const TABLE = 'ChatAgentTestCase'

export class TestCasesNotReadyError extends Error {
  constructor() {
    super('TEST_CASES_NOT_READY')
    this.name = 'TestCasesNotReadyError'
  }
}
export class TestCaseLimitError extends Error {
  constructor() {
    super('TEST_CASE_LIMIT')
    this.name = 'TestCaseLimitError'
  }
}

export type SavedTestRow = { id: string; title: string; steps: ScenarioStep[]; createdAt: Date }

async function ownsAgent(tenantId: string, agentId: string) {
  return Boolean(await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true } }))
}

export async function listTestCases(
  tenantId: string,
  agentId: string,
): Promise<{ available: boolean; cases: SavedTestRow[] } | null> {
  if (!(await ownsAgent(tenantId, agentId))) return null
  if (!(await isTableReady(TABLE))) return { available: false, cases: [] }
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; steps: unknown; createdAt: Date }>>`
    SELECT "id", "title", "steps", "createdAt" FROM "ChatAgentTestCase"
     WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}
     ORDER BY "createdAt" DESC LIMIT ${MAX_CASES_PER_AGENT}`
  return {
    available: true,
    cases: rows.map((r) => ({
      id: r.id,
      title: r.title,
      // Re-validated on the way out: a hand-edited row can never feed unexpected shapes to the playground.
      steps: (() => {
        const parsed = parseSavedTest({ title: r.title, steps: r.steps })
        return parsed.ok ? parsed.value.steps : []
      })(),
      createdAt: r.createdAt,
    })),
  }
}

export async function createTestCase(input: {
  tenantId: string
  agentId: string
  userId: string
  test: SavedTestInput
}): Promise<string | null> {
  if (!(await ownsAgent(input.tenantId, input.agentId))) return null
  if (!(await isTableReady(TABLE))) throw new TestCasesNotReadyError()
  const id = randomUUID()
  const results = await prisma.$transaction([
    prisma.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cases:' + input.agentId}))`,
    prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "ChatAgentTestCase" ("id", "tenantId", "agentId", "title", "steps", "createdBy")
      SELECT ${id}, ${input.tenantId}, ${input.agentId}, ${input.test.title}, ${JSON.stringify(input.test.steps)}::jsonb, ${input.userId}
       WHERE (SELECT count(*) FROM "ChatAgentTestCase" WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${input.agentId}) < ${MAX_CASES_PER_AGENT}
      RETURNING "id"`,
  ])
  if (!(results[1] as Array<{ id: string }>)[0]) throw new TestCaseLimitError()
  return id
}

export async function deleteTestCase(tenantId: string, agentId: string, caseId: string): Promise<boolean> {
  if (!(await isTableReady(TABLE))) throw new TestCasesNotReadyError()
  const n = await prisma.$executeRaw`
    DELETE FROM "ChatAgentTestCase" WHERE "id" = ${caseId} AND "tenantId" = ${tenantId} AND "agentId" = ${agentId}`
  return n > 0
}

export type ScenarioRunInput = {
  examined: number
  passed: number
  notRun: number
  failures: Array<{ id: string; title: string; reason: string }>
  customCount: number
}

/** Stores a finished playground run next to the automatic safety test (same history, suite "probar_scenarios"). */
export async function recordScenarioRun(input: {
  tenantId: string
  agentId: string
  userId: string
  run: ScenarioRunInput
}): Promise<{ saved: boolean } | null> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, version: true },
  })
  if (!agent) return null
  const examined = Math.max(0, Math.min(500, Math.floor(input.run.examined)))
  const passed = Math.max(0, Math.min(examined, Math.floor(input.run.passed)))
  const failures = input.run.failures.slice(0, 50).map((f) => ({
    id: String(f.id).slice(0, 60),
    title: String(f.title).slice(0, 80),
    reason: String(f.reason).slice(0, 200),
  }))
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChatAgentEvalRun"
        ("id", "tenantId", "agentId", "agentVersion", "suite", "fixtureSetHash", "examined",
         "passRate", "policyViolations", "results", "startedBy")
      VALUES (${randomUUID()}, ${input.tenantId}, ${agent.id}, ${agent.version}, 'probar_scenarios',
              ${`${SCENARIO_SET_VERSION}+${Math.max(0, Math.min(MAX_CASES_PER_AGENT, input.run.customCount))}`},
              ${examined}, ${examined ? passed / examined : 0}, ${failures.length},
              ${JSON.stringify(failures)}::jsonb, ${input.userId})`
  } catch (error) {
    if (isMissingRelation(error)) return { saved: false }
    throw error
  }
  return { saved: true }
}
