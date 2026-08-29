import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsOrderDateWhere } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

const statusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) return auth.response;
    const tenantId = auth.tenantId;

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // Check cache
    const cacheKey = `${tenantId}-${startDate}-${endDate}`;
    const cached = statusCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
    
    const prisma = getTenantPrisma(tenantId);
    const orderModel = prisma.order as any;

    const whereClause: any = {
      tenantId,
      ...buildStatsOrderDateWhere(startDate, endDate),
    };

    const [statusGroups, statuses] = await Promise.all([
      orderModel.groupBy({
        by: ['status'],
        where: whereClause,
        _count: {
          _all: true,
        },
      }),
      prisma.orderStatus.findMany({
        where: {
          isActive: true,
          tenantId
        },
        select: {
          label: true,
          color: true,
        },
      }),
    ]);

    const statusColorMap = new Map(
      statuses.map((s: { label: string; color: string | null }) => [s.label, s.color || '#3B82F6'])
    );

    // Calculate total and percentages
    const total = statusGroups.reduce((sum: number, group: any) => sum + group._count._all, 0);

    const result = statusGroups.map((group: any) => ({
      status: group.status,
      count: group._count._all,
      percentage: total > 0 ? (group._count._all / total) * 100 : 0,
      color: statusColorMap.get(group.status) || '#6B7280',
    }));

    // Store in cache
    statusCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching status breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status breakdown' },
      { status: 500 }
    );
  }
}

