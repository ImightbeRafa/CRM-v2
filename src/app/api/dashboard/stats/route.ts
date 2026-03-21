import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';

// Cache stats for 30 seconds to prevent repeated heavy queries
const statsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

// Helper to clear cache for a specific tenant (useful for debugging)
export function clearStatsCache(tenantId?: string) {
  if (tenantId) {
    statsCache.delete(tenantId);
  } else {
    statsCache.clear();
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = token.tenantId as string;
    
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

    // Calculate weekly revenue (exclude unconfirmed CE orders from revenue)
    const ordersWithTotals = await prisma.order.findMany({
      where: {
        ...whereClause,
        NOT: { contraEntrega: true, cePaymentConfirmed: false },
        timestamp: {
          gte: startOfWeek
        }
      },
      select: {
        total: true
      }
    });

    const weeklyRevenue = ordersWithTotals.reduce((sum: number, order: any) => sum + (order.total || 0), 0);

    // Calculate last week's revenue
    const ordersLastWeekWithTotals = await prisma.order.findMany({
      where: {
        ...whereClause,
        NOT: { contraEntrega: true, cePaymentConfirmed: false },
        timestamp: {
          gte: startOfLastWeek,
          lt: startOfWeek
        }
      },
      select: {
        total: true
      }
    });

    const lastWeekRevenue = ordersLastWeekWithTotals.reduce((sum: number, order: any) => sum + (order.total || 0), 0);

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
    
    // Store in cache
    statsCache.set(tenantId, { data: stats, timestamp: Date.now() });

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
