/**
 * Reads ChatAgentTurn aggregates. The platform variant (no tenantId) is only called from routes
 * gated by isSuperAdmin(); the tenant variant always passes the session tenantId.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { queryWithTimeout } from '@/lib/soft-ai/safe-query'
import type { AgentUsageMode, AgentUsageRow } from '@/lib/soft-ai/agent-usage'

const ROW_LIMIT = 5_000

type RawRow = {
  day: string
  tenantId: string
  agentId: string
  model: string
  mode: string
  status: string
  turns: number
  inputTokens: bigint | number | null
  cachedInputTokens: bigint | number | null
  outputTokens: bigint | number | null
  costMicros: bigint | number | null
}

/** `tenantId: null` is the explicit PLATFORM scope (super-admin routes only); a string is one business. */
export async function loadAgentUsageRows(input: {
  from: Date
  to: Date
  tenantId: string | null
}): Promise<AgentUsageRow[]> {
  const tenantFilter = input.tenantId !== null
    ? Prisma.sql`AND "tenantId" = ${input.tenantId}`
    : Prisma.empty
  const rows = await queryWithTimeout<RawRow[]>(Prisma.sql`
    SELECT to_char((("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date, 'YYYY-MM-DD') AS "day",
           "tenantId", "agentId", "model", "mode", "status",
           count(*)::int AS "turns",
           coalesce(sum("inputTokens"), 0)::bigint AS "inputTokens",
           coalesce(sum("cachedInputTokens"), 0)::bigint AS "cachedInputTokens",
           coalesce(sum("outputTokens"), 0)::bigint AS "outputTokens",
           coalesce(sum("estimatedCostMicros"), 0)::bigint AS "costMicros"
      FROM "ChatAgentTurn"
     WHERE "createdAt" >= ${input.from} AND "createdAt" < ${input.to}
       ${tenantFilter}
     GROUP BY 1, 2, 3, 4, 5, 6
     ORDER BY 1 DESC
     LIMIT ${ROW_LIMIT}`)
  return rows.map((row) => ({
    day: row.day,
    tenantId: row.tenantId,
    agentId: row.agentId,
    model: row.model,
    mode: row.mode,
    status: row.status,
    turns: Number(row.turns),
    inputTokens: Number(row.inputTokens ?? 0),
    cachedInputTokens: Number(row.cachedInputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    costMicros: Number(row.costMicros ?? 0),
  }))
}

export async function loadAgentP95Latency(input: {
  from: Date
  to: Date
  tenantId: string | null
  mode: AgentUsageMode
}): Promise<number | null> {
  const tenantFilter = input.tenantId !== null
    ? Prisma.sql`AND "tenantId" = ${input.tenantId}`
    : Prisma.empty
  const modeFilter =
    input.mode === 'all'
      ? Prisma.empty
      : input.mode === 'test'
        ? Prisma.sql`AND "mode" = 'test'`
        : Prisma.sql`AND "mode" <> 'test'`
  const result = await queryWithTimeout<Array<{ p95: number | null }>>(Prisma.sql`
    SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
      FROM "ChatAgentTurn"
     WHERE "createdAt" >= ${input.from} AND "createdAt" < ${input.to}
       AND "latencyMs" IS NOT NULL
       ${tenantFilter}
       ${modeFilter}`)
  const value = result[0]?.p95
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

export async function loadTenantNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const rows = await prisma.tenant.findMany({
    where: { id: { in: ids.slice(0, 500) } },
    select: { id: true, name: true },
  })
  return Object.fromEntries(rows.map((row) => [row.id, row.name]))
}

export async function loadAgentNames(
  ids: string[],
  tenantId: string | null,
): Promise<Record<string, { name: string; status: string; version: number }>> {
  if (ids.length === 0) return {}
  const rows = await prisma.chatAgent.findMany({
    where: { id: { in: ids.slice(0, 500) }, ...(tenantId !== null ? { tenantId } : {}) },
    select: { id: true, name: true, status: true, version: true },
  })
  return Object.fromEntries(
    rows.map((row) => [row.id, { name: row.name, status: row.status, version: row.version }]),
  )
}
