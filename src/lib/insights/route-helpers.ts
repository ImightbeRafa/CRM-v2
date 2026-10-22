/**
 * "Know what sells" (Lane E2) · shared bits of the read-only insight routes.
 */
import 'server-only'

import { NextResponse } from 'next/server'
import { auroraPeriodRange, DEFAULT_AURORA_PERIOD, resolveAuroraPeriodSpec, type AuroraPeriodSpec } from '@/lib/statistics-aurora'
import { AnalyticsBusyError, memoTtl } from '@/lib/soft-ai/safe-query'
import { InsightsTooLargeError } from '@/lib/insights/insights-server'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const NO_STORE = { 'Cache-Control': 'no-store' } as const

/** ?period=7d (default, same as the Resumen) | ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (Costa Rica calendar); invalid → null (400). */
export function readPeriod(params: URLSearchParams): { spec: AuroraPeriodSpec; range: { startDate: string; endDate: string } } | null {
  const spec = resolveAuroraPeriodSpec(params.get('period') ?? DEFAULT_AURORA_PERIOD, params.get('from'), params.get('to'))
  if (!spec) return null
  return { spec, range: auroraPeriodRange(spec) }
}

export function badPeriod(): NextResponse {
  return NextResponse.json({ error: 'Período inválido' }, { status: 400, headers: NO_STORE })
}

/** A business already has this many report loads running (cache misses) → the next one waits its turn (429). */
export const MAX_LOADS_PER_TENANT = 2
const running = new Map<string, number>()

export class InsightsTenantBusyError extends Error {
  constructor() {
    super('INSIGHTS_TENANT_BUSY')
    this.name = 'InsightsTenantBusyError'
  }
}

/**
 * Cached per tenant + parameters (the key always starts with the tenant id). Only cache misses hit the
 * database, and at most MAX_LOADS_PER_TENANT of them run at once per business (SecureDog INFRA-E2-2:
 * one user firing many different ranges must not hold the shared analytics slots).
 */
export function cached<T>(tenantId: string, parts: Array<string | number | null>, load: () => Promise<T>, ttlMs = 60_000): Promise<T> {
  return memoTtl(`insights:${tenantId}:${parts.map((p) => String(p ?? '')).join(':')}`, ttlMs, async () => {
    const now = running.get(tenantId) ?? 0
    if (now >= MAX_LOADS_PER_TENANT) throw new InsightsTenantBusyError()
    running.set(tenantId, now + 1)
    try {
      return await load()
    } finally {
      const left = (running.get(tenantId) ?? 1) - 1
      if (left <= 0) running.delete(tenantId)
      else running.set(tenantId, left)
    }
  })
}

const insightsRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 40, identifier: 'insights-reports' })

/** 40 report requests per minute per business; null = go ahead. */
export async function limitInsights(tenantId: string): Promise<NextResponse | null> {
  const result = await insightsRateLimit(tenantId)
  if (result.allowed) return null
  return NextResponse.json(
    { error: 'Demasiadas consultas seguidas. Esperá un minuto y probá de nuevo.' },
    { status: 429, headers: { ...NO_STORE, ...result.headers } },
  )
}

export function insightsError(tag: string, error: unknown): NextResponse {
  if (error instanceof InsightsTenantBusyError) {
    return NextResponse.json(
      { error: 'Ya hay reportes cargando para tu negocio. Probá de nuevo en unos segundos.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': '5' } },
    )
  }
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
