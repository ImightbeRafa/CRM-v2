/**
 * Agent usage summary (pure). Turns grouped rows from ChatAgentTurn into dashboard numbers.
 * Cost is an ESTIMATE at list price (see llm/usage.ts), never a provider invoice.
 */

export type AgentUsageMode = 'live' | 'test' | 'all'

export type AgentUsageRow = {
  day: string
  tenantId: string
  agentId: string
  model: string
  mode: string
  status: string
  turns: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costMicros: number
}

export type UsageBucket = {
  turns: number
  delivered: number
  suggested: number
  skipped: number
  fallback: number
  failed: number
  budgetBlocked: number
  windowClosed: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

export type AgentUsageSummary = {
  totals: UsageBucket & { fallbackRate: number; failureRate: number; p95LatencyMs: number | null }
  byModel: Array<{ model: string } & UsageBucket>
  byTenant: Array<{ tenantId: string } & UsageBucket>
  byAgent: Array<{ agentId: string; tenantId: string; model: string } & UsageBucket>
  byDay: Array<{ day: string } & UsageBucket>
}

export function emptyBucket(): UsageBucket {
  return {
    turns: 0,
    delivered: 0,
    suggested: 0,
    skipped: 0,
    fallback: 0,
    failed: 0,
    budgetBlocked: 0,
    windowClosed: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }
}

function add(bucket: UsageBucket, row: AgentUsageRow) {
  bucket.turns += row.turns
  bucket.inputTokens += row.inputTokens
  bucket.cachedInputTokens += row.cachedInputTokens
  bucket.outputTokens += row.outputTokens
  bucket.costUsd += row.costMicros / 1_000_000
  switch (row.status) {
    case 'delivered':
      bucket.delivered += row.turns
      break
    case 'suggested':
      bucket.suggested += row.turns
      break
    case 'skipped':
      bucket.skipped += row.turns
      break
    case 'fallback':
      bucket.fallback += row.turns
      break
    case 'failed':
      bucket.failed += row.turns
      break
    case 'budget_blocked':
      bucket.budgetBlocked += row.turns
      break
    case 'window_closed':
      bucket.windowClosed += row.turns
      break
    default:
      break
  }
}

function groupBy<T extends object>(
  rows: AgentUsageRow[],
  keyOf: (row: AgentUsageRow) => string,
  seed: (row: AgentUsageRow) => T,
): Array<T & UsageBucket> {
  const map = new Map<string, T & UsageBucket>()
  for (const row of rows) {
    const key = keyOf(row)
    let entry = map.get(key)
    if (!entry) {
      entry = { ...seed(row), ...emptyBucket() }
      map.set(key, entry)
    }
    add(entry, row)
  }
  return [...map.values()]
}

export function summarizeAgentUsage(
  rows: AgentUsageRow[],
  mode: AgentUsageMode,
  p95LatencyMs: number | null = null,
): AgentUsageSummary {
  const filtered = rows.filter((row) =>
    mode === 'all' ? true : mode === 'test' ? row.mode === 'test' : row.mode !== 'test',
  )
  const totals = emptyBucket()
  for (const row of filtered) add(totals, row)
  const attempted = totals.delivered + totals.suggested + totals.fallback + totals.failed
  return {
    totals: {
      ...totals,
      fallbackRate: attempted > 0 ? totals.fallback / attempted : 0,
      failureRate: attempted > 0 ? totals.failed / attempted : 0,
      p95LatencyMs,
    },
    byModel: groupBy(filtered, (r) => r.model, (r) => ({ model: r.model })).sort(
      (a, b) => b.costUsd - a.costUsd,
    ),
    byTenant: groupBy(filtered, (r) => r.tenantId, (r) => ({ tenantId: r.tenantId })).sort(
      (a, b) => b.costUsd - a.costUsd,
    ),
    byAgent: groupBy(
      filtered,
      (r) => `${r.agentId}:${r.model}`,
      (r) => ({ agentId: r.agentId, tenantId: r.tenantId, model: r.model }),
    ).sort((a, b) => b.turns - a.turns),
    byDay: groupBy(filtered, (r) => r.day, (r) => ({ day: r.day })).sort((a, b) =>
      a.day < b.day ? 1 : -1,
    ),
  }
}

/** Tenants see volume and outcomes, never dollars (COGS is platform-only). */
export function stripCost<T extends { costUsd?: number }>(value: T): Omit<T, 'costUsd'> {
  const rest: Partial<T> = { ...value }
  delete rest.costUsd
  return rest as Omit<T, 'costUsd'>
}

export function stripSummaryCost(summary: AgentUsageSummary) {
  return {
    totals: stripCost(summary.totals),
    byModel: summary.byModel.map(stripCost),
    byAgent: summary.byAgent.map(stripCost),
    byDay: summary.byDay.map(stripCost),
  }
}

/** Window in days, snapped to 1 / 7 / 30 / 90 so callers can't fan out into dozens of distinct heavy queries. */
export function clampUsageDays(raw: string | null | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 30
  if (n <= 1) return 1
  if (n <= 7) return 7
  if (n <= 30) return 30
  return 90
}

export function parseUsageMode(raw: string | null | undefined): AgentUsageMode {
  return raw === 'test' || raw === 'all' ? raw : 'live'
}
