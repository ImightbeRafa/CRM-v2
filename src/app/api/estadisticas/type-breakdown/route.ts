import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsOrderDateWhere } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

const typeCache = new Map<string, { data: any; timestamp: number }>();
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
    const cached = typeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
    
    const prisma = getTenantPrisma(tenantId);

    // NOTE: We intentionally DO NOT filter out unconfirmed contra-entrega (COD) orders here.
    // /produccion counts every saved order, so stats must too or the totals won't reconcile.
    const whereClause: any = {
      tenantId,
      ...buildStatsOrderDateWhere(startDate, endDate),
    };

    const [eaOrders, raOrders] = await Promise.all([
      prisma.order.aggregate({
        where: {
          ...whereClause,
          orderType: 'EA',
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: {
          ...whereClause,
          orderType: 'RA',
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    const result = {
      EA: {
        count: eaOrders._count._all,
        revenue: eaOrders._sum.total || 0,
      },
      RA: {
        count: raOrders._count._all,
        revenue: raOrders._sum.total || 0,
      },
    };
    
    // Store in cache
    typeCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching type breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order type breakdown' },
      { status: 500 }
    );
  }
}

