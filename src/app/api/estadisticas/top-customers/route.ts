import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

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
    
    // CRITICAL: Use tenant-isolated prisma client
    const prisma = getTenantPrisma(tenantId);

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = parseInt(searchParams.get('limit') || '10');

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

    // Get top customers by total revenue
    const topCustomersByRevenue = await prisma.order.groupBy({
      by: ['customerName'],
      where: whereClause,
      _sum: {
        total: true,
      },
      _count: {
        _all: true,
      },
      orderBy: {
        _sum: {
          total: 'desc',
        },
      } as any,
      take: limit,
    });

    // Get top customers by order count
    const topCustomersByOrders = await prisma.order.groupBy({
      by: ['customerName'],
      where: whereClause,
      _count: {
        _all: true,
      },
      _sum: {
        total: true,
      },
      orderBy: {
        _count: {
          customerName: 'desc',
        },
      } as any,
      take: limit,
    });

    // Get customer activity data (recent orders, average order value, etc.)
    const customerActivity = await prisma.order.groupBy({
      by: ['customerName'],
      where: whereClause,
      _sum: {
        total: true,
      },
      _count: {
        _all: true,
      },
      _min: {
        timestamp: true,
      },
      _max: {
        timestamp: true,
      },
      orderBy: {
        _max: {
          timestamp: 'desc',
        },
      } as any,
      take: limit,
    });

    // Calculate additional metrics for each customer
    const enhancedCustomerData = customerActivity.map(customer => {
      const revenue = customer._sum.total || 0;
      const orderCount = customer._count._all;
      const avgOrderValue = orderCount > 0 ? revenue / orderCount : 0;
      const firstOrder = customer._min.timestamp;
      const lastOrder = customer._max.timestamp;
      
      // Calculate days since last order
      const daysSinceLastOrder = lastOrder 
        ? Math.floor((new Date().getTime() - new Date(lastOrder).getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        customerName: customer.customerName,
        totalRevenue: revenue,
        orderCount: orderCount,
        averageOrderValue: avgOrderValue,
        firstOrderDate: firstOrder,
        lastOrderDate: lastOrder,
        daysSinceLastOrder: daysSinceLastOrder,
        customerStatus: daysSinceLastOrder === null ? 'No orders' :
                       daysSinceLastOrder <= 7 ? 'Very Active' :
                       daysSinceLastOrder <= 30 ? 'Active' :
                       daysSinceLastOrder <= 90 ? 'Moderate' : 'Inactive'
      };
    });

    // Get customer distribution by status
    const customerStatusDistribution = enhancedCustomerData.reduce((acc, customer) => {
      const status = customer.customerStatus;
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      topCustomersByRevenue: topCustomersByRevenue.map(customer => ({
        customerName: customer.customerName,
        totalRevenue: customer._sum.total || 0,
        orderCount: customer._count._all,
        averageOrderValue: customer._count._all > 0 ? (customer._sum.total || 0) / customer._count._all : 0
      })),
      topCustomersByOrders: topCustomersByOrders.map(customer => ({
        customerName: customer.customerName,
        orderCount: customer._count._all,
        totalRevenue: customer._sum.total || 0,
        averageOrderValue: customer._count._all > 0 ? (customer._sum.total || 0) / customer._count._all : 0
      })),
      customerActivity: enhancedCustomerData,
      customerStatusDistribution,
      summary: {
        totalCustomers: enhancedCustomerData.length,
        activeCustomers: enhancedCustomerData.filter(c => c.customerStatus === 'Very Active' || c.customerStatus === 'Active').length,
        totalRevenue: enhancedCustomerData.reduce((sum, c) => sum + c.totalRevenue, 0),
        averageOrderValue: enhancedCustomerData.reduce((sum, c) => sum + c.averageOrderValue, 0) / enhancedCustomerData.length || 0
      }
    });
  } catch (error) {
    console.error('Error fetching top customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top customers data' },
      { status: 500 }
    );
  }
}
