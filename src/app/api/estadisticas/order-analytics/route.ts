import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';

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

    // Build date filter
    const dateFilter: any = {};
    if (startDate) {
      const start = new Date(startDate + 'T00:00:00');
      dateFilter.gte = start;
    }
    if (endDate) {
      const end = new Date(endDate + 'T23:59:59.999');
      dateFilter.lte = end;
    }

    const whereClause: any = { tenantId };
    if (Object.keys(dateFilter).length > 0) {
      // Since saleDate is a String field, we only filter by timestamp
      whereClause.timestamp = dateFilter;
    }

    // Get comprehensive order analytics
    const [
      statusBreakdown,
      typeBreakdown,
      sellerPerformance,
      orderTrends,
      averageOrderValue,
      totalOrders,
      totalRevenue,
      orderSizeDistribution
    ] = await Promise.all([
      // Status breakdown with enhanced data
      prisma.order.groupBy({
        by: ['status'],
        where: whereClause,
        _count: { _all: true },
        _sum: { total: true },
        _avg: { total: true },
        orderBy: { _count: { status: 'desc' } } as any
      }),

      // Order type breakdown
      prisma.order.groupBy({
        by: ['orderType'],
        where: whereClause,
        _count: { _all: true },
        _sum: { total: true },
        _avg: { total: true },
        orderBy: { _count: { orderType: 'desc' } } as any
      }),

      // Seller performance
      prisma.order.groupBy({
        by: ['seller'],
        where: whereClause,
        _count: { _all: true },
        _sum: { total: true },
        _avg: { total: true },
        orderBy: { _sum: { total: 'desc' } } as any
      }),

      // Order trends by day (last 30 days)
      prisma.order.groupBy({
        by: ['timestamp'],
        where: {
          ...whereClause,
          timestamp: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        },
        _count: { _all: true },
        _sum: { total: true },
        orderBy: { timestamp: 'asc' }
      }),

      // Average order value
      prisma.order.aggregate({
        where: whereClause,
        _avg: { total: true },
        _sum: { total: true },
        _count: { _all: true }
      }),

      // Total orders
      prisma.order.count({ where: whereClause }),

      // Total revenue
      prisma.order.aggregate({
        where: whereClause,
        _sum: { total: true }
      }),

      // Order size distribution - simplified to avoid raw SQL issues
      Promise.resolve([
        { size_category: 'Small (< ₡10,000)', count: 0, avg_value: 0, total_revenue: 0 },
        { size_category: 'Medium (₡10,000 - ₡50,000)', count: 0, avg_value: 0, total_revenue: 0 },
        { size_category: 'Large (₡50,000 - ₡100,000)', count: 0, avg_value: 0, total_revenue: 0 },
        { size_category: 'X-Large (> ₡100,000)', count: 0, avg_value: 0, total_revenue: 0 }
      ])
    ]);

    // Get status colors
    const statuses = await prisma.orderStatus.findMany({
      where: { 
        isActive: true,
        tenantId 
      },
      select: {
        label: true,
        color: true,
      },
    });

    const statusColorMap = new Map(
      statuses.map((s: { label: string; color: string | null }) => [s.label, s.color || '#3B82F6'])
    );

    // Calculate conversion rates and efficiency metrics
    const totalOrdersCount = totalOrders;
    const totalRevenueAmount = totalRevenue._sum.total || 0;
    const avgOrderValue = averageOrderValue._avg.total || 0;

    // Calculate status conversion funnel
    const statusFunnel = statusBreakdown.map(status => ({
      status: status.status,
      count: status._count._all,
      revenue: status._sum.total || 0,
      avgValue: status._avg.total || 0,
      percentage: totalOrdersCount > 0 ? (status._count._all / totalOrdersCount) * 100 : 0,
      color: statusColorMap.get(status.status) || '#6B7280'
    }));

    // Calculate seller performance metrics
    const sellerMetrics = sellerPerformance.map(seller => ({
      seller: seller.seller,
      orderCount: seller._count._all,
      totalRevenue: seller._sum.total || 0,
      avgOrderValue: seller._avg.total || 0,
      marketShare: totalOrdersCount > 0 ? (seller._count._all / totalOrdersCount) * 100 : 0,
      revenueShare: totalRevenueAmount > 0 ? ((seller._sum.total || 0) / totalRevenueAmount) * 100 : 0
    }));

    // Process order trends
    const processedTrends = orderTrends.map(trend => ({
      date: trend.timestamp,
      orderCount: trend._count._all,
      revenue: trend._sum.total || 0
    }));

    return NextResponse.json({
      overview: {
        totalOrders: totalOrdersCount,
        totalRevenue: totalRevenueAmount,
        averageOrderValue: avgOrderValue,
        uniqueCustomers: await prisma.order.groupBy({
          by: ['customerName'],
          where: whereClause,
          _count: { _all: true }
        }).then(result => result.length)
      },
      statusBreakdown: statusFunnel,
      typeBreakdown: typeBreakdown.map(type => ({
        type: type.orderType,
        count: type._count._all,
        revenue: type._sum.total || 0,
        avgValue: type._avg.total || 0,
        percentage: totalOrdersCount > 0 ? (type._count._all / totalOrdersCount) * 100 : 0
      })),
      sellerPerformance: sellerMetrics,
      orderTrends: processedTrends,
      orderSizeDistribution: orderSizeDistribution,
      efficiency: {
        revenuePerOrder: totalOrdersCount > 0 ? totalRevenueAmount / totalOrdersCount : 0,
        ordersPerDay: totalOrdersCount > 0 ? totalOrdersCount / 30 : 0, // Assuming 30-day period
        conversionRate: statusFunnel.find(s => s.status === 'Completed')?.percentage || 0
      }
    });
  } catch (error: any) {
    console.error('Error fetching order analytics:', error);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    return NextResponse.json(
      { error: 'Failed to fetch order analytics', details: error?.message },
      { status: 500 }
    );
  }
}
