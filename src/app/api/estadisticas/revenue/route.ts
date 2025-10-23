import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { startOfDay, startOfWeek, startOfMonth, format } from 'date-fns';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get tenant ID from session
    const tenantId = (session as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const groupBy = searchParams.get('groupBy') || 'day'; // day, week, month

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    // Get all orders in the date range (with tenant isolation)
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        timestamp: {
          gte: start,
          lte: end,
        },
      },
      select: {
        timestamp: true,
        total: true,
      },
      orderBy: {
        timestamp: 'asc',
      },
    });

    // Group by specified period
    const grouped = new Map<string, { revenue: number; orderCount: number }>();

    orders.forEach((order: { timestamp: Date; total: number | null }) => {
      let key: string;
      const orderDate = new Date(order.timestamp);

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

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching revenue data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch revenue data' },
      { status: 500 }
    );
  }
}

