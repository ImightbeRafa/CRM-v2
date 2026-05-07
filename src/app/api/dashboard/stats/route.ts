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
    
    // Fetch orders this week
    const ordersThisWeek = await prisma.order.count({
      where: {
        ...whereClause,
        timestamp: {
          gte: startOfWeek
        }
      }
    });

    // Fetch orders last week
    const ordersLastWeek = await prisma.order.count({
      where: {
        ...whereClause,
        timestamp: {
          gte: startOfLastWeek,
          lt: startOfWeek
        }
      }
    });

    // Calculate percentage change
    const ordersChange = ordersLastWeek > 0 
      ? Math.round(((ordersThisWeek - ordersLastWeek) / ordersLastWeek) * 100)
      : ordersThisWeek > 0 ? 100 : 0;

    // Fetch pending orders (orders not in completed/delivered status)
    // Common completed/delivered status values in Spanish
    const completedStatuses = ['Completado', 'Entregado', 'Cancelado', 'Rechazado'];
    
    const pendingOrders = await prisma.order.count({
      where: {
        ...whereClause,
        status: {
          notIn: completedStatuses
        }
      }
    });

    // Fetch total clients
    const totalClients = await prisma.client.count({
      where: whereClause
    });

    // Fetch clients from last week for comparison
    const clientsLastWeek = await prisma.client.count({
      where: {
        ...whereClause,
        createdAt: {
          lt: startOfWeek
        }
      }
    });

    const newClientsThisWeek = totalClients - clientsLastWeek;

    const weeklyRevenueAgg = await prisma.order.aggregate({
      where: {
        ...whereClause,
        NOT: { contraEntrega: true, cePaymentConfirmed: false },
        timestamp: { gte: startOfWeek },
      },
      _sum: { total: true },
    });
    const weeklyRevenue = weeklyRevenueAgg._sum.total || 0;

    const lastWeekRevenueAgg = await prisma.order.aggregate({
      where: {
        ...whereClause,
        NOT: { contraEntrega: true, cePaymentConfirmed: false },
        timestamp: { gte: startOfLastWeek, lt: startOfWeek },
      },
      _sum: { total: true },
    });
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

    console.log(`[Dashboard Stats] Tenant ${tenantId}: Orders this week: ${ordersThisWeek}, Pending: ${pendingOrders}, Clients: ${totalClients}, Revenue: ${weeklyRevenue}`);


    return NextResponse.json(stats);

  } catch (error) {
    console.error('❌ [Dashboard Stats] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}
