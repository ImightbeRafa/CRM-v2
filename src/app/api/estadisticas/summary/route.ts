import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { resolveTenantId } from '@/lib/api-tenant';
import { buildStatsOrderDateWhere, getPreviousStatsPeriod } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

const summaryCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;
const CACHE_MAX = 200;

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = await resolveTenantId(req, token);
    if (!tenantId) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }
    
    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
    // Check cache
    const cacheKey = `${tenantId}-${startDate}-${endDate}`;
    const cached = summaryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
    
    const prisma = getTenantPrisma(tenantId);
    const orderModel = prisma.order as any;

    // NOTE: We intentionally DO NOT filter out unconfirmed contra-entrega (COD) orders here.
    // /produccion counts every saved order, so stats must too or the totals won't reconcile.
    const whereClause: any = {
      tenantId,
      ...buildStatsOrderDateWhere(startDate, endDate),
    };

    // Get current period data
    const [orders, totalRevenue] = await Promise.all([
      orderModel.count({ where: whereClause }),
      orderModel.aggregate({
        where: whereClause,
        _sum: { total: true },
      }),
    ]);

    // Get unique clients
    const uniqueClients = await orderModel.groupBy({
      by: ['customerName'],
      where: whereClause,
    });

    const totalSales = orders;
    const revenue = totalRevenue._sum.total || 0;
    const averageOrderValue = totalSales > 0 ? revenue / totalSales : 0;
    const activeClients = uniqueClients.length;

    // Calculate trends (compare with previous period)
    let trends = null;
    if (startDate && endDate) {
      const previousPeriod = getPreviousStatsPeriod(startDate, endDate);
      if (!previousPeriod) {
        trends = null;
      } else {
        // Keep previous-period WHERE consistent with current-period logic:
        // match on saleDate when available, else fall back to timestamp.
        const previousWhereClause: any = {
          tenantId,
          ...buildStatsOrderDateWhere(previousPeriod.startDate, previousPeriod.endDate),
        };

        const [prevOrders, prevRevenue] = await Promise.all([
          orderModel.count({ where: previousWhereClause }),
          orderModel.aggregate({
            where: previousWhereClause,
            _sum: { total: true },
          }),
        ]);

        const prevTotal = prevRevenue._sum.total || 0;
        const prevAvg = prevOrders > 0 ? prevTotal / prevOrders : 0;

        trends = {
          sales: prevOrders > 0 ? ((totalSales - prevOrders) / prevOrders) * 100 : 0,
          revenue: prevTotal > 0 ? ((revenue - prevTotal) / prevTotal) * 100 : 0,
          avgOrderValue: prevAvg > 0 ? ((averageOrderValue - prevAvg) / prevAvg) * 100 : 0,
        };
      }
    }

    const result = {
      totalSales,
      totalRevenue: revenue,
      averageOrderValue,
      activeClients,
      trends,
    };
    
    summaryCache.set(cacheKey, { data: result, timestamp: Date.now() });
    if (summaryCache.size > CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of summaryCache) { if (now - v.timestamp > CACHE_TTL) summaryCache.delete(k); }
      if (summaryCache.size > CACHE_MAX) { const first = summaryCache.keys().next().value; if (first) summaryCache.delete(first); }
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics summary' },
      { status: 500 }
    );
  }
}

