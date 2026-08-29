import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsDateRange, buildStatsOrderDateWhere } from '@/lib/statistics-dates';
import { readTenantUiReadiness } from '@/lib/feature-flags';
import { buildStatisticsV2Overview } from '@/lib/statistics-v2';

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

  const tenantPrisma = getTenantPrisma(auth.tenantId);
  const [orders, statuses] = await Promise.all([
    tenantPrisma.order.findMany({
      where: { tenantId: auth.tenantId, ...buildStatsOrderDateWhere(startDate, endDate) },
      select: {
        id: true, orderId: true, orderType: true, status: true, customerName: true, total: true,
        saleDate: true, timestamp: true, seller: true, salesChannel: true, contraEntrega: true, cePaymentConfirmed: true,
      },
      orderBy: [{ saleDate: 'desc' }, { timestamp: 'desc' }],
      take: 25_001,
    }),
    tenantPrisma.orderStatus.findMany({
      where: { tenantId: auth.tenantId, isActive: true },
      select: { label: true, color: true },
    }),
  ]);
  if (orders.length > 25_000) {
    return NextResponse.json({ error: 'This range is too large; choose a shorter period' }, { status: 413 });
  }
  const overview = buildStatisticsV2Overview(
    orders,
    new Map(statuses.map(status => [status.label, status.color || '#3B82F6'])),
  );
  const data = { ...overview, mode: readiness.statistics.mode };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  return NextResponse.json(data);
}
