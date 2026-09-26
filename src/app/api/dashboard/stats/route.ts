import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPI } from '@/lib/auth-helpers';

const statsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;
const CACHE_MAX_SIZE = 200;

function pruneCache() {
  if (statsCache.size <= CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, val] of statsCache) {
    if (now - val.timestamp > CACHE_TTL) statsCache.delete(key);
  }
  if (statsCache.size > CACHE_MAX_SIZE) {
    const toDelete = statsCache.size - CACHE_MAX_SIZE;
    let i = 0;
    for (const key of statsCache.keys()) {
      if (i++ >= toDelete) break;
      statsCache.delete(key);
    }
  }
}

// Helper to clear cache for a specific tenant (useful for debugging)
function clearStatsCache(tenantId?: string) {
  if (tenantId) {
    statsCache.delete(tenantId);
  } else {
    statsCache.clear();
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;

    const tenantId = auth.tenantId;
    
    // Check for force refresh parameter
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = statsCache.get(tenantId);
      if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        return NextResponse.json(cached.data);
      }
    }

    // SECURITY: Always use tenant-isolated client for dashboard stats
    const prisma = getTenantPrisma(tenantId);

    // Calculate date for this week (Monday to Sunday)
    const now = new Date();
    const startOfWeek = new Date(now);
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Adjust to Monday (1 = Monday, 0 = Sunday)
    startOfWeek.setDate(now.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);

    // Get last week for comparison
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    // Build where clause (tenant filter auto-injected by middleware)
    const whereClause: any = {};
    const completedStatuses = ['Completado', 'Entregado', 'Cancelado', 'Rechazado'];

    // Last-7-days revenue series (Costa Rica is UTC-6 year-round, no DST)
    const CR_OFFSET_MS = 6 * 60 * 60 * 1000;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const dayKey = (d: Date) => new Date(d.getTime() - CR_OFFSET_MS).toISOString().slice(0, 10);
    const dailyKeys = Array.from({ length: 7 }, (_, i) => dayKey(new Date(now.getTime() - (6 - i) * DAY_MS)));
    const dailyStart = new Date(Date.parse(`${dailyKeys[0]}T00:00:00.000Z`) + CR_OFFSET_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

    const [ordersThisWeek, ordersLastWeek, pendingOrders, totalClients, clientsLastWeek, weeklyRevenueAgg, lastWeekRevenueAgg, dailyOrders, pendingOver7Days, cePendingAgg] = await Promise.all([
      prisma.order.count({
        where: {
          ...whereClause,
          timestamp: {
            gte: startOfWeek
          }
        }
      }),
      prisma.order.count({
        where: {
          ...whereClause,
          timestamp: {
            gte: startOfLastWeek,
            lt: startOfWeek
          }
        }
      }),
      prisma.order.count({
        where: {
          ...whereClause,
          status: {
            notIn: completedStatuses
          }
        }
      }),
      prisma.client.count({
        where: whereClause
      }),
      prisma.client.count({
        where: {
          ...whereClause,
          createdAt: {
            lt: startOfWeek
          }
        }
      }),
      prisma.order.aggregate({
        where: {
          ...whereClause,
          NOT: { contraEntrega: true, cePaymentConfirmed: false },
          timestamp: { gte: startOfWeek },
        },
        _sum: { total: true },
      }),
      prisma.order.aggregate({
        where: {
          ...whereClause,
          NOT: { contraEntrega: true, cePaymentConfirmed: false },
          timestamp: { gte: startOfLastWeek, lt: startOfWeek },
        },
        _sum: { total: true },
      }),
      prisma.order.findMany({
        where: {
          ...whereClause,
          NOT: { contraEntrega: true, cePaymentConfirmed: false },
          timestamp: { gte: dailyStart },
        },
        select: { timestamp: true, total: true },
      }),
      prisma.order.count({
        where: {
          ...whereClause,
          status: { notIn: completedStatuses },
          timestamp: { lt: sevenDaysAgo },
        },
      }),
      prisma.order.aggregate({
        where: {
          ...whereClause,
          contraEntrega: true,
          cePaymentConfirmed: false,
          status: { notIn: completedStatuses },
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    const dailyTotals = new Map<string, number>(dailyKeys.map((k) => [k, 0]));
    for (const o of dailyOrders) {
      const k = dayKey(o.timestamp);
      if (dailyTotals.has(k)) dailyTotals.set(k, (dailyTotals.get(k) ?? 0) + (o.total || 0));
    }
    const dailyRevenue = dailyKeys.map((date) => ({ date, total: Math.round(dailyTotals.get(date) ?? 0) }));

    const ordersChange = ordersLastWeek > 0
      ? Math.round(((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100)
      : ordersThisWeek > 0 ? 100 : 0;

    const newClientsThisWeek = totalClients - clientsLastWeek;
    const weeklyRevenue = weeklyRevenueAgg._sum.total || 0;
    const lastWeekRevenue = lastWeekRevenueAgg._sum.total || 0;

    const revenueChange = lastWeekRevenue > 0
      ? Math.round(((weeklyRevenue - lastWeekRevenue) / lastWeekRevenue) * 100)
      : weeklyRevenue > 0 ? 100 : 0;

    const stats = {
      ordersWeek: ordersThisWeek,
      ordersChange,
      pendingOrders,
      totalClients,
      newClientsThisWeek,
      weeklyRevenue: Math.round(weeklyRevenue),
      revenueChange,
      dailyRevenue,
      pendingOver7Days,
      cePendingCount: cePendingAgg._count._all,
      cePendingTotal: Math.round(cePendingAgg._sum.total || 0),
      // Debug info (only in development)
      ...(process.env.NODE_ENV === 'development' && {
        _debug: {
          tenantId,
          startOfWeek: startOfWeek.toISOString(),
          completedStatuses,
          ordersLastWeek,
          lastWeekRevenue
        }
      })
    };
    
    statsCache.set(tenantId, { data: stats, timestamp: Date.now() });
    pruneCache();

    return NextResponse.json(stats);

  } catch (error) {
    console.error('❌ [Dashboard Stats] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}
