import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

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

    // Get EA orders
    const eaOrders = await prisma.order.aggregate({
      where: {
        ...whereClause,
        orderType: 'EA',
      },
      _count: { _all: true },
      _sum: { total: true },
    });

    // Get RA orders
    const raOrders = await prisma.order.aggregate({
      where: {
        ...whereClause,
        orderType: 'RA',
      },
      _count: { _all: true },
      _sum: { total: true },
    });

    return NextResponse.json({
      EA: {
        count: eaOrders._count._all,
        revenue: eaOrders._sum.total || 0,
      },
      RA: {
        count: raOrders._count._all,
        revenue: raOrders._sum.total || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching type breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order type breakdown' },
      { status: 500 }
    );
  }
}

