import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';

// Cache stats for 30 seconds to prevent repeated heavy queries
const statsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000; // 30 seconds

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = token.tenantId as string;
    
    // Check cache first
    const cached = statsCache.get(tenantId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const prisma = getTenantPrisma(tenantId);

    // Calculate date for this week (Monday to Sunday)
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Go to Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    // Get last week for comparison
    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

    // Fetch orders this week
    const ordersThisWeek = await prisma.order.count({
      where: {
        tenantId,
        timestamp: {
          gte: startOfWeek
        }
      }
    });

    // Fetch orders last week
    const ordersLastWeek = await prisma.order.count({
      where: {
        tenantId,
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

    // Fetch pending orders (orders not in completed/cancelled status)
    const pendingOrders = await prisma.order.count({
      where: {
        tenantId,
        status: {
          not: 'completed'
        }
      }
    });

    // Fetch total clients
    const totalClients = await prisma.client.count({
      where: {
        tenantId
      }
    });

    // Fetch clients from last week for comparison
    const clientsLastWeek = await prisma.client.count({
      where: {
        tenantId,
        createdAt: {
          lt: startOfWeek
        }
      }
    });

    const newClientsThisWeek = totalClients - clientsLastWeek;

    // Calculate weekly revenue (sum of all order totals this week)
    const ordersWithTotals = await prisma.order.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startOfWeek
        }
      },
      select: {
        total: true
      }
    });

    const weeklyRevenue = ordersWithTotals.reduce((sum, order) => sum + (order.total || 0), 0);

    // Calculate last week's revenue
    const ordersLastWeekWithTotals = await prisma.order.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: startOfLastWeek,
          lt: startOfWeek
        }
      },
      select: {
        total: true
      }
    });

    const lastWeekRevenue = ordersLastWeekWithTotals.reduce((sum, order) => sum + (order.total || 0), 0);

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
      revenueChange
    };
    
    // Store in cache
    statsCache.set(tenantId, { data: stats, timestamp: Date.now() });

    return NextResponse.json(stats);

  } catch (error) {
    console.error('❌ [Dashboard Stats] Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard statistics' },
      { status: 500 }
    );
  }
}
