import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { readClientsServerReadiness } from '@/lib/feature-flags';
import { buildClientWhere, clientCursorScope, parseClientQuery } from '@/lib/client-query';
import { decodeTimestampCursor, encodeTimestampCursor, parsePageLimit } from '@/lib/cursor-pagination';
import { PII_NO_STORE_HEADERS } from '@/lib/security';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_sales');
  if (!auth.ok) return auth.response;
  const readiness = await readClientsServerReadiness(auth.tenantId);
  if (!readiness.enabled) {
    return NextResponse.json({
      error: readiness.requested ? 'Client history backfill is not ready' : 'Feature disabled',
      code: readiness.requested ? 'BACKFILL_REQUIRED' : 'FEATURE_DISABLED',
    }, { status: 409, headers: PII_NO_STORE_HEADERS });
  }
  try {
    const { searchParams } = new URL(request.url);
    const input = parseClientQuery(searchParams);
    const limit = parsePageLimit(searchParams.get('limit'), 50);
    const scope = clientCursorScope(input);
    const cursor = decodeTimestampCursor(searchParams.get('cursor'), scope);
    const baseWhere = buildClientWhere(input);
    const where = cursor ? {
      AND: [
        baseWhere,
        {
          OR: [
            { lastOrder: { lt: new Date(cursor.timestamp) } },
            { lastOrder: new Date(cursor.timestamp), id: { lt: cursor.id } },
          ],
        },
      ],
    } : baseWhere;
    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const facetWhere = buildClientWhere({ ...input, state: 'all' });
    const [rows, pageTotal, totalClients, active, newThisMonth, revenue, facets] = await Promise.all([
      tenantPrisma.client.findMany({
        where,
        orderBy: [{ lastOrder: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
      tenantPrisma.client.count({ where: baseWhere }),
      tenantPrisma.client.count({ where: facetWhere }),
      tenantPrisma.client.count({ where: { AND: [facetWhere, { isActive: true }] } }),
      tenantPrisma.client.count({ where: { AND: [facetWhere, { firstOrder: { gte: monthStart } }] } }),
      tenantPrisma.client.aggregate({ where: facetWhere, _sum: { totalSpent: true }, _avg: { averageOrderValue: true } }),
      tenantPrisma.client.findMany({
        where: facetWhere,
        distinct: ['province', 'canton'],
        select: { province: true, canton: true },
        orderBy: [{ province: 'asc' }, { canton: 'asc' }],
      }),
    ]);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return NextResponse.json({
      status: 'success',
      data: {
        items,
        pageInfo: {
          hasMore,
          totalCount: pageTotal,
          nextCursor: hasMore && last
            ? encodeTimestampCursor({ timestamp: last.lastOrder.toISOString(), id: last.id }, scope)
            : null,
        },
        stats: {
          totalClients,
          activeClients: active,
          newClientsThisMonth: newThisMonth,
          totalRevenue: revenue._sum.totalSpent || 0,
          averageOrderValue: revenue._avg.averageOrderValue || 0,
        },
        facets,
        backfillCompletedAt: readiness.backfillCompletedAt,
      },
    }, { headers: PII_NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid client query';
    const clientError = /Invalid|between|at least/.test(message);
    if (!clientError) console.error('[automatic-clients/v2]', message);
    return NextResponse.json({ error: clientError ? message : 'Failed to load clients' }, {
      status: clientError ? 400 : 500,
      headers: PII_NO_STORE_HEADERS,
    });
  }
}
