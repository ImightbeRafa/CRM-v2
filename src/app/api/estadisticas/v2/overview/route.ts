import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsDateRange } from '@/lib/statistics-dates';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import { fetchStatisticsV2PeriodOverview } from '@/lib/statistics-period-query';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 30_000;
const MAX_CACHE = 100;

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_statistics');
  if (!auth.ok) return auth.response;
  const readiness = await readTenantUiReadiness(auth.tenantId);
  if (!readiness.statistics.enabled) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const startDate = request.nextUrl.searchParams.get('startDate');
  const endDate = request.nextUrl.searchParams.get('endDate');
  const range = buildStatsDateRange(startDate, endDate);
  if (!range.start || !range.end || range.end < range.start) {
    return NextResponse.json({ error: 'Valid startDate and endDate are required' }, { status: 400 });
  }
  if (range.end.getTime() - range.start.getTime() > 366 * 86_400_000) {
    return NextResponse.json({ error: 'Date range cannot exceed 366 days' }, { status: 400 });
  }
  const key = `${auth.tenantId}:${startDate}:${endDate}:${readiness.statistics.mode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return NextResponse.json(hit.data);

  try {
    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const overview = await fetchStatisticsV2PeriodOverview(tenantPrisma, {
      tenantId: auth.tenantId,
      startDate: startDate!,
      endDate: endDate!,
    });
    const data = { ...overview, mode: readiness.statistics.mode };
    cache.set(key, { at: Date.now(), data });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load statistics';
    const status = (error as { status?: number })?.status === 413 ? 413 : 500;
    if (status >= 500) console.error('[estadisticas/v2/overview]', message);
    return NextResponse.json({ error: message }, { status });
  }
}
