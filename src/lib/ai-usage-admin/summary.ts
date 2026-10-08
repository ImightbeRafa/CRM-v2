/**
 * Owner AI usage dashboard (F2): aggregates over "AiUsageEvent" (SQL 048). Platform-wide, super admin only
 * (callers check). Aggregates only — ids, names, counts, cost, timing; never customer text.
 * Costs are list-price estimates (rate-card.ts), not provider invoices.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'

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

const SUMS = `COUNT(*)::bigint AS "calls",
  COUNT(*) FILTER (WHERE "status" = 'error')::bigint AS "errors",
  COALESCE(SUM("inputTokens"), 0)::bigint AS "inputTokens",
  COALESCE(SUM("cachedTokens"), 0)::bigint AS "cachedTokens",
  COALESCE(SUM("outputTokens"), 0)::bigint AS "outputTokens",
  COALESCE(SUM("audioSeconds"), 0)::float8 AS "audioSeconds",
  COALESCE(SUM("costMicros"), 0)::bigint AS "costMicros"`

/** Parameterized WHERE for the filters (values never interpolated). */
function where(f: UsageFilters, startIndex = 1): { sql: string; params: unknown[] } {
  const parts = [`"createdAt" >= $${startIndex}`, `"createdAt" < $${startIndex + 1}`]
  const params: unknown[] = [f.from, f.to]
  let i = startIndex + 2
  if (f.tenantId) {
    parts.push(`"tenantId" = $${i++}`)
    params.push(f.tenantId)
  }
  if (f.model) {
    parts.push(`"model" = $${i++}`)
    params.push(f.model)
  }
  if (f.feature) {
    parts.push(`"feature" = $${i++}`)
    params.push(f.feature)
  }
  return { sql: parts.join(' AND '), params }
}

async function q(sql: string, params: unknown[]): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(sql, ...params)
}

export async function loadUsageDashboard(f: UsageFilters) {
  if (!(await isTableReady('AiUsageEvent'))) return { available: false as const }
  const w = where(f)
  const [totals, latency, byDayFeature, byDayModel, byTenant, byModel, byFeature, byAgent, topConversations, errors] =
    await Promise.all([
      q(`SELECT ${SUMS} FROM "AiUsageEvent" WHERE ${w.sql}`, w.params),
      q(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") AS "p50",
                percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
           FROM "AiUsageEvent" WHERE ${w.sql} AND "latencyMs" IS NOT NULL`,
        w.params,
      ),
      q(
        `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "day", "feature" AS "key", ${SUMS}
           FROM "AiUsageEvent" WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 1`,
        w.params,
      ),
      q(
        `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS "day", "model" AS "key", ${SUMS}
           FROM "AiUsageEvent" WHERE ${w.sql} GROUP BY 1, 2 ORDER BY 1`,
        w.params,
      ),
      q(`SELECT "tenantId", ${SUMS} FROM "AiUsageEvent" WHERE ${w.sql} GROUP BY 1 ORDER BY "costMicros" DESC LIMIT 100`, w.params),
      q(
        `SELECT "model", "provider", ${SUMS},
                percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") AS "p95"
           FROM "AiUsageEvent" WHERE ${w.sql} GROUP BY 1, 2 ORDER BY "costMicros" DESC`,
        w.params,
      ),
      q(`SELECT "feature", ${SUMS} FROM "AiUsageEvent" WHERE ${w.sql} GROUP BY 1 ORDER BY "costMicros" DESC`, w.params),
      q(
        `SELECT "agentId", "tenantId", ${SUMS} FROM "AiUsageEvent"
          WHERE ${w.sql} AND "agentId" IS NOT NULL GROUP BY 1, 2 ORDER BY "costMicros" DESC LIMIT 100`,
        w.params,
      ),
      q(
        `SELECT "conversationId", "tenantId", ${SUMS} FROM "AiUsageEvent"
          WHERE ${w.sql} AND "conversationId" IS NOT NULL GROUP BY 1, 2 ORDER BY "costMicros" DESC LIMIT 20`,
        w.params,
      ),
      q(
        `SELECT "createdAt", "tenantId", "feature", "model", "errorCode", "latencyMs" FROM "AiUsageEvent"
          WHERE ${w.sql} AND "status" = 'error' ORDER BY "createdAt" DESC LIMIT 50`,
        w.params,
      ),
    ])

  const tenantIds = [...new Set([...byTenant, ...byAgent, ...topConversations].map((r) => r.tenantId).filter(Boolean) as string[])]
  const agentIds = [...new Set(byAgent.map((r) => r.agentId).filter(Boolean) as string[])]
  const [tenants, agents] = await Promise.all([
    tenantIds.length ? prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } }) : [],
    agentIds.length ? prisma.chatAgent.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true } }) : [],
  ])
  const tenantName = Object.fromEntries(tenants.map((t) => [t.id, t.name]))
  const agentName = Object.fromEntries(agents.map((a) => [a.id, a.name]))

  return {
    available: true as const,
    totals: bucket(totals[0] || {}),
    latency: { p50: n(latency[0]?.p50) || null, p95: n(latency[0]?.p95) || null },
    byDay: {
      feature: byDayFeature.map((r) => ({ day: String(r.day), key: String(r.key), ...bucket(r) })),
      model: byDayModel.map((r) => ({ day: String(r.day), key: String(r.key), ...bucket(r) })),
    },
    byTenant: byTenant.map((r) => ({
      tenantId: (r.tenantId as string | null) ?? null,
      name: r.tenantId ? tenantName[String(r.tenantId)] || 'Negocio' : 'Plataforma (sin negocio)',
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

/** Spend headline: today, 7d, 30d, month-to-date and a straight-line month-end projection (UTC). */
export async function loadSpendHeadline(now = new Date()) {
  if (!(await isTableReady('AiUsageEvent'))) return null
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COALESCE(SUM("costMicros") FILTER (WHERE "createdAt" >= date_trunc('day', ${now}::timestamp)), 0)::bigint AS "today",
      COALESCE(SUM("costMicros") FILTER (WHERE "createdAt" >= ${now}::timestamp - INTERVAL '7 days'), 0)::bigint AS "d7",
      COALESCE(SUM("costMicros") FILTER (WHERE "createdAt" >= ${now}::timestamp - INTERVAL '30 days'), 0)::bigint AS "d30",
      COALESCE(SUM("costMicros") FILTER (WHERE "createdAt" >= date_trunc('month', ${now}::timestamp)), 0)::bigint AS "mtd"
    FROM "AiUsageEvent" WHERE "createdAt" >= ${now}::timestamp - INTERVAL '32 days'`
  const r = rows[0] || {}
  const mtd = n(r.mtd)
  const day = now.getUTCDate()
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const elapsed = Math.max(1, day - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440)
  return {
    todayMicros: n(r.today),
    d7Micros: n(r.d7),
    d30Micros: n(r.d30),
    mtdMicros: mtd,
    projectedMonthMicros: Math.round((mtd / elapsed) * daysInMonth),
  }
}

/** Month-to-date spend per business (and the platform total) for budget checks. */
export async function loadMonthSpendByScope(now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!(await isTableReady('AiUsageEvent'))) return out
  const rows = await prisma.$queryRaw<Array<{ tenantId: string | null; cost: bigint }>>`
    SELECT "tenantId", COALESCE(SUM("costMicros"), 0)::bigint AS "cost"
      FROM "AiUsageEvent" WHERE "createdAt" >= date_trunc('month', ${now}::timestamp)
     GROUP BY 1`
  let total = 0
  for (const r of rows) {
    const c = Number(r.cost)
    total += c
    if (r.tenantId) out.set(r.tenantId, c)
  }
  out.set('global', total)
  return out
}

export function usageCsv(d: Exclude<Awaited<ReturnType<typeof loadUsageDashboard>>, { available: false }>): string {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = ['seccion,clave,llamadas,errores,tokens_entrada,tokens_cache,tokens_salida,audio_seg,costo_usd']
  const push = (section: string, key: string, b: UsageBucket) =>
    lines.push(
      [section, key, b.calls, b.errors, b.inputTokens, b.cachedTokens, b.outputTokens, b.audioSeconds, (b.costMicros / 1e6).toFixed(6)]
        .map(esc)
        .join(','),
    )
  for (const r of d.byTenant) push('negocio', r.name, r)
  for (const r of d.byModel) push('modelo', r.model, r)
  for (const r of d.byFeature) push('funcion', r.label, r)
  for (const r of d.byAgent) push('agente', `${r.tenantName} / ${r.name}`, r)
  for (const r of d.byDay.feature) push('dia_funcion', `${r.day} ${r.key}`, r)
  return lines.join('\n')
}
