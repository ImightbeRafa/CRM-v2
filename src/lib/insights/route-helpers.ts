/**
 * "Know what sells" (Lane E2) · shared bits of the read-only insight routes.
 */
import 'server-only'

import { NextResponse } from 'next/server'
import { auroraPeriodRange, resolveAuroraPeriodSpec, type AuroraPeriodSpec } from '@/lib/statistics-aurora'
import { AnalyticsBusyError, memoTtl } from '@/lib/soft-ai/safe-query'
import { InsightsTooLargeError } from '@/lib/insights/insights-server'

export const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** ?period=30d | ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (Costa Rica calendar); invalid → null (400). */
export function readPeriod(params: URLSearchParams): { spec: AuroraPeriodSpec; range: { startDate: string; endDate: string } } | null {
  const spec = resolveAuroraPeriodSpec(params.get('period') ?? '30d', params.get('from'), params.get('to'))
  if (!spec) return null
  return { spec, range: auroraPeriodRange(spec) }
}

export function badPeriod(): NextResponse {
  return NextResponse.json({ error: 'Período inválido' }, { status: 400, headers: NO_STORE })
}

/** Cached per tenant + parameters (the key always starts with the tenant id). */
export function cached<T>(tenantId: string, parts: Array<string | number | null>, load: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  return memoTtl(`insights:${tenantId}:${parts.map((p) => String(p ?? '')).join(':')}`, ttlMs, load)
}

export function insightsError(tag: string, error: unknown): NextResponse {
  if (error instanceof AnalyticsBusyError) {
    return NextResponse.json(
      { error: 'Hay muchas consultas en curso. Probá de nuevo en un momento.' },
      { status: 503, headers: { ...NO_STORE, 'Retry-After': '10' } },
    )
  }
  if (error instanceof InsightsTooLargeError) {
    return NextResponse.json({ error: 'Hay demasiados datos en ese período. Elegí un período más corto.' }, { status: 413, headers: NO_STORE })
  }
  console.error(`[insights ${tag}]`, error instanceof Error ? error.name : 'unknown')
  return NextResponse.json({ error: 'No se pudo cargar el reporte.' }, { status: 500, headers: NO_STORE })
}
