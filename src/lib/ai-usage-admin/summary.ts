/**
 * Owner AI usage dashboard (F2): aggregates over "AiUsageEvent" (SQL 048). Platform-wide, super admin only
 * (callers check). Aggregates only — ids, names, counts, cost, timing; never customer text.
 * Costs are list-price estimates (rate-card.ts), not provider invoices.
 * Days and months are Costa Rica calendar days (the owner's clock); createdAt is stored as UTC.
 * Every statement goes through the analytics guard (≤2 at a time per process, 8 s timeout) so a dashboard
 * open can never starve the database pool used by webhooks and the inbox.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { queryWithTimeout } from '@/lib/soft-ai/safe-query'
import { csvCell } from '@/lib/csv-safe'

export const AI_USAGE_FEATURE_LABELS: Record<string, string> = {
  inbox_agent: 'Agente del inbox',
  probar: 'Probar (pruebas manuales)',
  agent_test: 'Probar y activar (pruebas automáticas)',
  agent_import: 'Crear desde fuentes',
  shortcut_import: 'Importar atajos',
  vision: 'Visión (imágenes)',
  transcription: 'Audio (transcripción)',
  customer_paste: 'Pegar datos de cliente',
  staff_bot: 'Bot del staff (texto)',
  staff_bot_voice: 'Bot del staff (voz)',
  template: 'Plantillas WhatsApp',
  other: 'Otro',
}

const CR_TZ = 'America/Costa_Rica'

/** "2026-10" for the Costa Rica calendar month of `now`. */
export function costaRicaMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: CR_TZ, year: 'numeric', month: '2-digit' }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  return `${y}-${m}`
}

export type UsageFilters = {
  from: Date
  to: Date
  tenantId?: string | null
  model?: string | null
  feature?: string | null
}

export type UsageBucket = {
  calls: number
  errors: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  audioSeconds: number
  costMicros: number
}

type Row = Record<string, unknown>
const n = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0) || 0)

function bucket(r: Row): UsageBucket {
  return {
    calls: n(r.calls),
    errors: n(r.errors),
    inputTokens: n(r.inputTokens),
    cachedTokens: n(r.cachedTokens),
    outputTokens: n(r.outputTokens),
    audioSeconds: n(r.audioSeconds),
    costMicros: n(r.costMicros),
  }
}

const SUMS = Prisma.sql`COUNT(*)::bigint AS "calls",
  COUNT(*) FILTER (WHERE "status" = 'error')::bigint AS "errors",
  COALESCE(SUM("inputTokens"), 0)::bigint AS "inputTokens",
  COALESCE(SUM("cachedTokens"), 0)::bigint AS "cachedTokens",
  COALESCE(SUM("outputTokens"), 0)::bigint AS "outputTokens",
  COALESCE(SUM("audioSeconds"), 0)::float8 AS "audioSeconds",
  COALESCE(SUM("costMicros"), 0)::bigint AS "costMicros"`

/** Costa Rica local day of an event (createdAt is UTC without time zone). */
const CR_DAY = Prisma.sql`to_char(date_trunc('day', ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CR_TZ}), 'YYYY-MM-DD')`

/** Filters as one bound SQL fragment (values are always parameters). */
function where(f: UsageFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`"createdAt" >= ${f.from}`, Prisma.sql`"createdAt" < ${f.to}`]
  if (f.tenantId) parts.push(Prisma.sql`"tenantId" = ${f.tenantId}`)
  if (f.model) parts.push(Prisma.sql`"model" = ${f.model}`)
  if (f.feature) parts.push(Prisma.sql`"feature" = ${f.feature}`)
  return Prisma.join(parts, ' AND ')
}

const q = (sql: Prisma.Sql) => queryWithTimeout<Row[]>(sql)

export async function loadUsageDashboard(f: UsageFilters) {
  if (!(await isTableReady('AiUsageEvent'))) return { available: false as const }
  const w = where(f)
  // The analytics guard runs at most 2 of these at a time; the rest wait their turn.
  const [totals, latency, byDayFeature, byDayModel, byTenant, byModel, byFeature, byAgent, topConversations, errors] =
    await Promise.all([
      q(Prisma.sql`SELECT ${SUMS}, COUNT(DISTINCT "conversationId")::bigint AS "conversations" FROM "AiUsageEvent" WHERE ${w}`),
      q(Prisma.sql`
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "p50",
               percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
          FROM "AiUsageEvent" WHERE ${w} AND "latencyMs" IS NOT NULL`),
      q(Prisma.sql`SELECT ${CR_DAY} AS "day", "feature" AS "key", ${SUMS} FROM "AiUsageEvent" WHERE ${w} GROUP BY 1, 2 ORDER BY 1`),
      q(Prisma.sql`SELECT ${CR_DAY} AS "day", "model" AS "key", ${SUMS} FROM "AiUsageEvent" WHERE ${w} GROUP BY 1, 2 ORDER BY 1`),
      q(Prisma.sql`
        SELECT "tenantId", ${SUMS}, COUNT(DISTINCT "conversationId")::bigint AS "conversations"
          FROM "AiUsageEvent" WHERE ${w} GROUP BY 1 ORDER BY "costMicros" DESC LIMIT 100`),
      q(Prisma.sql`
        SELECT "model", "provider", ${SUMS}, percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
          FROM "AiUsageEvent" WHERE ${w} GROUP BY 1, 2 ORDER BY "costMicros" DESC`),
      q(Prisma.sql`SELECT "feature", ${SUMS} FROM "AiUsageEvent" WHERE ${w} GROUP BY 1 ORDER BY "costMicros" DESC`),
      q(Prisma.sql`
        SELECT "agentId", "tenantId", ${SUMS}, COUNT(DISTINCT "conversationId")::bigint AS "conversations"
          FROM "AiUsageEvent" WHERE ${w} AND "agentId" IS NOT NULL GROUP BY 1, 2 ORDER BY "costMicros" DESC LIMIT 100`),
      q(Prisma.sql`
        SELECT "conversationId", "tenantId", ${SUMS} FROM "AiUsageEvent"
         WHERE ${w} AND "conversationId" IS NOT NULL GROUP BY 1, 2 ORDER BY "costMicros" DESC LIMIT 20`),
      q(Prisma.sql`
        SELECT "createdAt", "tenantId", "feature", "model", "errorCode", "latencyMs" FROM "AiUsageEvent"
         WHERE ${w} AND "status" = 'error' ORDER BY "createdAt" DESC LIMIT 50`),
    ])

  const tenantIds = [...new Set([...byTenant, ...byAgent, ...topConversations].map((r) => r.tenantId).filter(Boolean) as string[])]
  const agentIds = [...new Set(byAgent.map((r) => r.agentId).filter(Boolean) as string[])]
  const [tenants, agents] = await Promise.all([
    tenantIds.length ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [],
    agentIds.length ? prisma.chatAgent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [],
  ])
  const tenantName = Object.fromEntries(tenants.map((t) => [t.id, t.name]))
  const agentName = Object.fromEntries(agents.map((a) => [a.id, a.name]))
  const day = (r: Row) => ({ day: String(r.day), key: String(r.key), ...bucket(r) })

  return {
    available: true as const,
    totals: { ...bucket(totals[0] || {}), conversations: n(totals[0]?.conversations) },
    latency: { p50: n(latency[0]?.p50) || null, p95: n(latency[0]?.p95) || null },
    byDay: { feature: byDayFeature.map(day), model: byDayModel.map(day) },
    byTenant: byTenant.map((r) => ({
      tenantId: (r.tenantId as string | null) ?? null,
      name: r.tenantId ? tenantName[String(r.tenantId)] || 'Negocio' : 'Plataforma (sin negocio)',
      conversations: n(r.conversations),
      ...bucket(r),
    })),
    byModel: byModel.map((r) => ({ model: String(r.model), provider: String(r.provider), p95: n(r.p95) || null, ...bucket(r) })),
    byFeature: byFeature.map((r) => ({
      feature: String(r.feature),
      label: AI_USAGE_FEATURE_LABELS[String(r.feature)] || String(r.feature),
      ...bucket(r),
    })),
    byAgent: byAgent.map((r) => ({
      agentId: String(r.agentId),
      name: agentName[String(r.agentId)] || 'Agente',
      tenantName: r.tenantId ? tenantName[String(r.tenantId)] || 'Negocio' : '—',
      conversations: n(r.conversations),
      ...bucket(r),
    })),
    topConversations: topConversations.map((r) => ({
      conversationId: String(r.conversationId),
      tenantName: r.tenantId ? tenantName[String(r.tenantId)] || 'Negocio' : '—',
      ...bucket(r),
    })),
    errors: errors.map((r) => ({
      at: (r.createdAt as Date).toISOString(),
      tenantName: r.tenantId ? tenantName[String(r.tenantId)] || 'Negocio' : 'Plataforma',
      feature: AI_USAGE_FEATURE_LABELS[String(r.feature)] || String(r.feature),
      model: String(r.model),
      errorCode: r.errorCode ? String(r.errorCode) : null,
      latencyMs: r.latencyMs == null ? null : n(r.latencyMs),
    })),
  }
}

/** Platform spend headline in Costa Rica days/months: today, 7d, 30d, month-to-date, straight-line projection. */
export async function loadSpendHeadline(now = new Date()) {
  if (!(await isTableReady('AiUsageEvent'))) return null
  const rows = await queryWithTimeout<Row[]>(Prisma.sql`
    WITH ev AS (
      SELECT "costMicros", ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CR_TZ} AS "local"
        FROM "AiUsageEvent" WHERE "createdAt" >= ${new Date(now.getTime() - 33 * 86_400_000)}
    ), clock AS (SELECT (${now}::timestamptz AT TIME ZONE ${CR_TZ}) AS "nowLocal")
    SELECT
      COALESCE(SUM("costMicros") FILTER (WHERE "local" >= date_trunc('day', "nowLocal")), 0)::bigint AS "today",
      COALESCE(SUM("costMicros") FILTER (WHERE "local" >= "nowLocal" - INTERVAL '7 days'), 0)::bigint AS "d7",
      COALESCE(SUM("costMicros") FILTER (WHERE "local" >= "nowLocal" - INTERVAL '30 days'), 0)::bigint AS "d30",
      COALESCE(SUM("costMicros") FILTER (WHERE "local" >= date_trunc('month', "nowLocal")), 0)::bigint AS "mtd"
    FROM clock LEFT JOIN ev ON TRUE GROUP BY "nowLocal"`)
  const r = rows[0] || {}
  const mtd = n(r.mtd)
  const local = new Date(now.toLocaleString('en-US', { timeZone: CR_TZ }))
  const daysInMonth = new Date(local.getFullYear(), local.getMonth() + 1, 0).getDate()
  const elapsed = Math.max(1, local.getDate() - 1 + (local.getHours() * 60 + local.getMinutes()) / 1440)
  return {
    todayMicros: n(r.today),
    d7Micros: n(r.d7),
    d30Micros: n(r.d30),
    mtdMicros: mtd,
    projectedMonthMicros: Math.round((mtd / elapsed) * daysInMonth),
  }
}

/** Month-to-date (Costa Rica month) spend per business and the platform total, for budget checks. */
export async function loadMonthSpendByScope(now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!(await isTableReady('AiUsageEvent'))) return out
  const rows = await queryWithTimeout<Array<{ tenantId: string | null; cost: bigint }>>(Prisma.sql`
    SELECT "tenantId", COALESCE(SUM("costMicros"), 0)::bigint AS "cost"
      FROM "AiUsageEvent"
     WHERE "createdAt" >= ${new Date(now.getTime() - 33 * 86_400_000)}
       AND (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${CR_TZ}) >= date_trunc('month', ${now}::timestamptz AT TIME ZONE ${CR_TZ})
     GROUP BY 1`)
  let total = 0
  for (const r of rows) {
    const c = Number(r.cost)
    total += c
    if (r.tenantId) out.set(r.tenantId, c)
  }
  out.set('global', total)
  return out
}

/** CSV with formula-safe cells (csvCell neutralizes leading = + - @ and control characters). */
export function usageCsv(d: Exclude<Awaited<ReturnType<typeof loadUsageDashboard>>, { available: false }>): string {
  const lines = ['seccion,clave,llamadas,errores,tokens_entrada,tokens_cache,tokens_salida,audio_seg,costo_usd']
  const push = (section: string, key: string, b: UsageBucket) =>
    lines.push(
      [
        csvCell(section),
        csvCell(key),
        csvCell(b.calls),
        csvCell(b.errors),
        csvCell(b.inputTokens),
        csvCell(b.cachedTokens),
        csvCell(b.outputTokens),
        csvCell(Number(b.audioSeconds.toFixed(2))),
        csvCell(Number((b.costMicros / 1e6).toFixed(6))),
      ].join(','),
    )
  for (const r of d.byTenant) push('negocio', r.name, r)
  for (const r of d.byModel) push('modelo', r.model, r)
  for (const r of d.byFeature) push('funcion', r.label, r)
  for (const r of d.byAgent) push('agente', `${r.tenantName} / ${r.name}`, r)
  for (const r of d.byDay.feature) push('dia_funcion', `${r.day} ${r.key}`, r)
  return lines.join('\n')
}
