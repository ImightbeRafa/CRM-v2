import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's tenant through memberships
    const user = await prisma.user.findUnique({
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

    // Build date filter - use saleDate if available, fallback to timestamp
    // Handle timezone properly by treating dates as local
    const dateFilter: any = {};
    if (startDate) {
      // Start of day in local timezone
      const start = new Date(startDate + 'T00:00:00');
      dateFilter.gte = start;
    }
    if (endDate) {
      // End of day in local timezone (23:59:59.999)
      const end = new Date(endDate + 'T23:59:59.999');
      dateFilter.lte = end;
    }

    const whereClause: any = { tenantId };
    if (Object.keys(dateFilter).length > 0) {
      // Use saleDate when available (more accurate for sales stats), fallback to timestamp
      const saleDateFilter = {
        gte: dateFilter.gte?.toISOString(),
        lte: dateFilter.lte?.toISOString()
      };
      whereClause.OR = [
        { saleDate: saleDateFilter },
        { saleDate: null, timestamp: dateFilter }
      ];
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
        tenantId,
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

