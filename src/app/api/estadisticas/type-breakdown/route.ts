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

