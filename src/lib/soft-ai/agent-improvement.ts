/**
 * Agent improvement loop (server): version snapshots, staff feedback, scorecard and automatic test runs.
 * Uses raw SQL against SQL 045 tables (and existing tables); every function is fail-safe when the
 * tables are not applied yet ("not ready"), and every query is scoped by tenantId from the session.
 */
import 'server-only'

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { queryWithTimeout } from '@/lib/soft-ai/safe-query'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { replayFixtures } from '@/lib/soft-ai/agent-replay'
import {
  buildVersionSnapshot,
  hashSnapshot,
  mergeScorecardParts,
  type ScorecardCounts,
  type ScorecardRow,
  type VersionSnapshotSource,
} from '@/lib/soft-ai/agent-scorecard'
import { SOFT_AI_PROMPT_CODE_VERSION } from '@/lib/soft-ai/agent-types'
import {
  canSharePaymentFacts,
  parseBrandFactsSafe,
  parseReplyStyleSafe,
} from '@/lib/soft-ai/brand-facts'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'

const isMissingTable = isMissingRelation

export class ImprovementNotReadyError extends Error {
  constructor() {
    super('IMPROVEMENT_NOT_READY')
    this.name = 'ImprovementNotReadyError'
  }
}

/** Best-effort: never blocks an agent edit. Idempotent per (agentId, version). */
export async function recordAgentVersionSnapshot(input: {
  tenantId: string
  agentId: string
  version: number
  agent: VersionSnapshotSource
  actorUserId?: string | null
}): Promise<void> {
  const snapshot = buildVersionSnapshot(input.agent)
  const hash = hashSnapshot(snapshot)
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChatAgentVersion"
        ("id", "tenantId", "agentId", "version", "snapshot", "snapshotHash", "promptCodeVersion", "createdBy")
      VALUES (${randomUUID()}, ${input.tenantId}, ${input.agentId}, ${input.version},
              ${JSON.stringify(snapshot)}::jsonb, ${hash}, ${SOFT_AI_PROMPT_CODE_VERSION},
              ${input.actorUserId ?? null})
      ON CONFLICT ("agentId", "version") DO NOTHING`
  } catch (error) {
    if (!isMissingTable(error)) {
      console.error('[agent-improvement] snapshot failed', error instanceof Error ? error.name : 'unknown')
    }
  }
}

/**
 * Lazy backfill: make sure the CURRENT version of every agent (of this business, or all for the platform
 * view) has a snapshot. Versions bumped by shortcut/knowledge/import edits get theirs the next time the
 * scorecard is opened. Past versions cannot be reconstructed.
 */
export async function ensureCurrentVersionSnapshots(tenantId?: string): Promise<void> {
  try {
    const agents = await prisma.chatAgent.findMany({
      where: tenantId ? { tenantId } : {},
      take: 500,
    })
    for (const agent of agents) {
      await recordAgentVersionSnapshot({
        tenantId: agent.tenantId,
        agentId: agent.id,
        version: agent.version,
        agent,
      })
    }
  } catch (error) {
    console.error('[agent-improvement] backfill failed', error instanceof Error ? error.name : 'unknown')
  }
}

export type FeedbackResult =
  | { ok: true }
  | { ok: false; code: 'TURN_NOT_FOUND' | 'NOT_READY' }

/** Staff thumbs. The turn must belong to the session tenant (no existence leak across tenants). */
export async function submitAgentFeedback(input: {
  tenantId: string
  actorUserId: string
  turnId: string
  rating: 1 | -1
  reasonCode: string | null
  note: string | null
}): Promise<FeedbackResult> {
  const turn = await prisma.chatAgentTurn.findFirst({
    where: { id: input.turnId, tenantId: input.tenantId },
    select: { id: true, agentId: true, agentVersion: true },
  })
  if (!turn) return { ok: false, code: 'TURN_NOT_FOUND' }
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChatAgentFeedback"
        ("id", "tenantId", "agentId", "agentVersion", "turnId", "rating", "reasonCode", "note", "actorUserId")
      VALUES (${randomUUID()}, ${input.tenantId}, ${turn.agentId}, ${turn.agentVersion}, ${turn.id},
              ${input.rating}, ${input.reasonCode}, ${input.note}, ${input.actorUserId})
      ON CONFLICT ("tenantId", "actorUserId", "turnId") DO UPDATE
        SET "rating" = EXCLUDED."rating", "reasonCode" = EXCLUDED."reasonCode",
            "note" = EXCLUDED."note", "updatedAt" = now()`
  } catch (error) {
    if (isMissingTable(error)) return { ok: false, code: 'NOT_READY' }
    throw error
  }
  return { ok: true }
}

type CountRow = Partial<ScorecardCounts> & { agentId: string; agentVersion: number }

/** `tenantId: null` is the explicit PLATFORM scope (super-admin routes only); a string is one business. */
export async function loadAgentScorecard(input: {
  from: Date
  to: Date
  tenantId: string | null
}): Promise<{ rows: ScorecardRow[]; feedbackReady: boolean }> {
  await ensureCurrentVersionSnapshots(input.tenantId ?? undefined)
  const tenantTurn = input.tenantId !== null ? Prisma.sql`AND t."tenantId" = ${input.tenantId}` : Prisma.empty

  const turns = await queryWithTimeout<CountRow[]>(Prisma.sql`
    SELECT t."agentId", t."agentVersion", min(t."model") AS "model",
           count(*)::int AS "turns",
           (count(*) FILTER (WHERE t."status" = 'delivered'))::int AS "delivered",
           (count(*) FILTER (WHERE t."status" = 'suggested'))::int AS "suggested",
           (count(*) FILTER (WHERE t."status" = 'fallback'))::int AS "fallback",
           (count(*) FILTER (WHERE t."status" = 'failed'))::int AS "failed",
           (count(*) FILTER (WHERE t."status" = 'delivered' AND EXISTS (
              SELECT 1 FROM "ChatMessage" m
               WHERE m."conversationId" = t."conversationId" AND m."tenantId" = t."tenantId" AND m."direction" = 'outbound'
                 AND m."sentAt" > t."createdAt" AND m."sentAt" < t."createdAt" + interval '30 minutes'
                 AND coalesce(m."metadata"->>'softAi', '') <> 'true')))::int AS "takeoverAfterSend",
           (count(DISTINCT t."conversationId") FILTER (WHERE t."status" IN ('delivered', 'suggested')))::int AS "attendedConversations",
           (count(DISTINCT t."conversationId") FILTER (WHERE t."status" IN ('delivered', 'suggested') AND EXISTS (
              SELECT 1 FROM "ChatConversation" c
                JOIN "Order" o ON o."clientId" = c."clientId" AND o."tenantId" = t."tenantId"
               WHERE c."id" = t."conversationId" AND c."tenantId" = t."tenantId" AND c."clientId" IS NOT NULL
                 AND o."deletedAt" IS NULL
                 AND o."timestamp" >= t."createdAt" AND o."timestamp" < t."createdAt" + interval '7 days')))::int AS "convertedConversations"
      FROM "ChatAgentTurn" t
     WHERE t."createdAt" >= ${input.from} AND t."createdAt" < ${input.to}
       AND t."mode" <> 'test' ${tenantTurn}
     GROUP BY t."agentId", t."agentVersion"
     LIMIT 500`)

  const suggestions = await queryWithTimeout<CountRow[]>(Prisma.sql`
    SELECT t."agentId", t."agentVersion",
           (count(*) FILTER (WHERE s."status" = 'accepted'))::int AS "suggestionsAccepted",
           (count(*) FILTER (WHERE s."status" = 'edited'))::int AS "suggestionsEdited",
           (count(*) FILTER (WHERE s."status" = 'dismissed'))::int AS "suggestionsDismissed"
      FROM "ChatAgentSuggestion" s
      JOIN "ChatAgentTurn" t ON t."id" = s."turnId" AND t."tenantId" = s."tenantId"
     WHERE s."createdAt" >= ${input.from} AND s."createdAt" < ${input.to}
       ${input.tenantId !== null ? Prisma.sql`AND s."tenantId" = ${input.tenantId}` : Prisma.empty}
     GROUP BY t."agentId", t."agentVersion"
     LIMIT 500`)

  let feedback: CountRow[] = []
  let feedbackReady = true
  try {
    feedback = await queryWithTimeout<CountRow[]>(Prisma.sql`
      SELECT f."agentId", f."agentVersion",
             (count(*) FILTER (WHERE f."rating" = 1))::int AS "thumbsUp",
             (count(*) FILTER (WHERE f."rating" = -1))::int AS "thumbsDown"
        FROM "ChatAgentFeedback" f
       WHERE f."createdAt" >= ${input.from} AND f."createdAt" < ${input.to}
         AND f."agentVersion" IS NOT NULL
         ${input.tenantId !== null ? Prisma.sql`AND f."tenantId" = ${input.tenantId}` : Prisma.empty}
       GROUP BY f."agentId", f."agentVersion"
       LIMIT 500`)
  } catch (error) {
    if (!isMissingTable(error)) throw error
    feedbackReady = false
  }
  return { rows: mergeScorecardParts([turns, suggestions, feedback]), feedbackReady }
}

export const EVAL_SUITE_SAFETY = 'safety_rules_v2'

/**
 * Automatic test run: replays the frozen WhatsApp fixture set through the agent's deterministic
 * safety layer (payment handling, handoff, no confirmation wording). No tokens, no sends, no key needed.
 * The LLM-judge part of the suite arrives with the OpenAI key (held).
 */
export async function runAgentSafetyEval(input: {
  tenantId: string
  agentId: string
  actorUserId: string
}): Promise<
  | {
      ok: true
      saved: boolean
      runId: string
      agentVersion: number
      examined: number
      passRate: number
      policyViolations: number
      failures: Array<{ id: string; tag: string; reason: string }>
    }
  | { ok: false; code: 'AGENT_NOT_FOUND' }
> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, version: true, brandFacts: true, replyStyle: true },
  })
  if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND' }
  const shortcuts = await listRuntimeShortcuts(input.tenantId, agent.id)
  const facts = parseBrandFactsSafe(agent.brandFacts)
  const report = replayFixtures({
    brandFacts: facts,
    replyStyle: parseReplyStyleSafe(agent.replyStyle),
    shortcuts,
    sharePaymentFacts: canSharePaymentFacts(facts),
  })
  const failures = report.rows
    .filter((row) => !row.pass)
    .map((row) => ({
      id: row.id,
      tag: row.tag,
      reason: row.policyViolation
        ? 'palabra de confirmación de pago'
        : row.expectedHandoff !== row.actualHandoff
          ? 'derivación a una persona distinta de la esperada'
          : 'clasificación de pago distinta de la esperada',
    }))
  const runId = randomUUID()
  let saved = true
  try {
    await prisma.$executeRaw`
      INSERT INTO "ChatAgentEvalRun"
        ("id", "tenantId", "agentId", "agentVersion", "suite", "fixtureSetHash", "examined",
         "passRate", "policyViolations", "results", "startedBy")
      VALUES (${runId}, ${input.tenantId}, ${agent.id}, ${agent.version}, ${EVAL_SUITE_SAFETY},
              ${report.fixtureSetHash}, ${report.examined}, ${report.passRate}, ${report.policyViolations},
              ${JSON.stringify(failures)}::jsonb, ${input.actorUserId})`
    // Keep the last 20 runs per agent (the table is a history for comparison, not an archive).
    await prisma.$executeRaw`
      DELETE FROM "ChatAgentEvalRun"
       WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${agent.id}
         AND "id" NOT IN (
           SELECT "id" FROM "ChatAgentEvalRun"
            WHERE "tenantId" = ${input.tenantId} AND "agentId" = ${agent.id}
            ORDER BY "createdAt" DESC LIMIT 20)`
  } catch (error) {
    if (!isMissingTable(error)) throw error
    saved = false
  }
  return {
    ok: true,
    saved,
    runId,
    agentVersion: agent.version,
    examined: report.examined,
    passRate: report.passRate,
    policyViolations: report.policyViolations,
    failures,
  }
}

export async function loadLatestEvalRuns(tenantId: string, agentId: string, take = 5) {
  try {
    return await prisma.$queryRaw<
      Array<{
        id: string
        agentVersion: number
        suite: string
        examined: number
        passRate: number
        policyViolations: number
        createdAt: Date
      }>
    >`SELECT "id", "agentVersion", "suite", "examined", "passRate", "policyViolations", "createdAt"
        FROM "ChatAgentEvalRun"
       WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}
       ORDER BY "createdAt" DESC LIMIT ${take}`
  } catch (error) {
    if (isMissingTable(error)) return []
    throw error
  }
}
