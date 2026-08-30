import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { fetchDailyRevenueAggregates } from '@/lib/statistics-period-query';
import type { StatsGroupBy } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

const revenueCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;
const CACHE_MAX = 200;

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) return auth.response;
    const tenantId = auth.tenantId;

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const requestedGroupBy = searchParams.get('groupBy') || 'day';
    const groupBy: StatsGroupBy = requestedGroupBy === 'week' || requestedGroupBy === 'month' ? requestedGroupBy : 'day';
    
    // Check cache
    const cacheKey = `${tenantId}-${startDate}-${endDate}-${groupBy}`;
    const cached = revenueCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
    
    const prisma = getTenantPrisma(tenantId);

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    // Period totals via SQL GROUP BY — never hydrate every order row.
    // NOTE: We intentionally DO NOT filter out unconfirmed contra-entrega (COD) orders here.
    // /produccion counts every saved order, so stats must too or the totals won't reconcile.
    const result = await fetchDailyRevenueAggregates(prisma, tenantId, startDate, endDate, groupBy);

    revenueCache.set(cacheKey, { data: result, timestamp: Date.now() });
    if (revenueCache.size > CACHE_MAX) {
      const now = Date.now();
      for (const [k, v] of revenueCache) { if (now - v.timestamp > CACHE_TTL) revenueCache.delete(k); }
      if (revenueCache.size > CACHE_MAX) { const first = revenueCache.keys().next().value; if (first) revenueCache.delete(first); }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching revenue data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch revenue data' },
      { status: 500 }
    );
  }
}
