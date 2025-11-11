import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

// Cache results for 30 seconds
const revenueCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30000;

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's tenant through memberships
    const user = await globalPrisma.user.findUnique({
      where: { id: token.sub },
      select: {
        memberships: {
          where: { isActive: true },
          select: { tenantId: true },
          take: 1
        }
      }
    });

    if (!user || !user.memberships || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const tenantId = user.memberships[0].tenantId;

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month
    
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

    // Handle timezone properly by treating dates as local
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59.999');

    // Get all orders in the date range (with tenant isolation)
    // Use saleDate when available for more accurate sales reporting
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        OR: [
          {
            saleDate: {
              gte: start.toISOString(),
              lte: end.toISOString(),
            },
          },
          {
            saleDate: null,
            timestamp: {
              gte: start,
              lte: end,
            },
          },
        ],
      },
      select: {
        timestamp: true,
        saleDate: true,
        total: true,
      },
      orderBy: [
        { saleDate: 'asc' },
        { timestamp: 'asc' },
      ],
    });

    // Group by specified period
    const grouped = new Map<string, { revenue: number; orderCount: number }>();

    orders.forEach((order: { timestamp: Date; saleDate: string | null; total: number | null }) => {
      let key: string;
      // Use saleDate if available, otherwise use timestamp
      const orderDate = order.saleDate ? new Date(order.saleDate) : new Date(order.timestamp);

      if (groupBy === 'week') {
        key = format(startOfWeek(orderDate), 'yyyy-MM-dd');
      } else if (groupBy === 'month') {
        key = format(startOfMonth(orderDate), 'yyyy-MM');
      } else {
        // default to day
        key = format(startOfDay(orderDate), 'yyyy-MM-dd');
      }

      const existing = grouped.get(key) || { revenue: 0, orderCount: 0 };
      grouped.set(key, {
        revenue: existing.revenue + (order.total || 0),
        orderCount: existing.orderCount + 1,
      });
    });

    // Convert map to array and sort
    const result = Array.from(grouped.entries())
      .map(([date, data]) => ({
        date,
        revenue: data.revenue,
        orderCount: data.orderCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Store in cache
    revenueCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching revenue data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch revenue data' },
      { status: 500 }
    );
  }
}

