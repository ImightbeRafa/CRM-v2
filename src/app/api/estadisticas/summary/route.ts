import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

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

    // Build date filter
    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }

    const whereClause: any = { tenantId };
    if (Object.keys(dateFilter).length > 0) {
      whereClause.timestamp = dateFilter;
    }

    // Get current period data
    const [orders, totalRevenue] = await Promise.all([
      prisma.order.count({ where: whereClause }),
      prisma.order.aggregate({
        where: whereClause,
        _sum: { total: true },
      }),
    ]);

    // Get unique clients
    const uniqueClients = await prisma.order.groupBy({
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
      const start = new Date(startDate);
      const end = new Date(endDate);
      const periodLength = end.getTime() - start.getTime();
      
      const previousStart = new Date(start.getTime() - periodLength);
      const previousEnd = new Date(start.getTime());

      const previousWhereClause = {
        timestamp: {
          gte: previousStart,
          lt: previousEnd,
        },
      };

      const [prevOrders, prevRevenue] = await Promise.all([
        prisma.order.count({ where: previousWhereClause }),
        prisma.order.aggregate({
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

    return NextResponse.json({
      totalSales,
      totalRevenue: revenue,
      averageOrderValue,
      activeClients,
      trends,
    });
  } catch (error) {
    console.error('Error fetching summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch statistics summary' },
      { status: 500 }
    );
  }
}

