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

    // Group orders by status
    const statusGroups = await prisma.order.groupBy({
      by: ['status'],
      where: whereClause,
      _count: {
        _all: true,
      },
    });

    // Get status colors from OrderStatus table (with tenant isolation)
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

    // Calculate total and percentages
    const total = statusGroups.reduce((sum: number, group: any) => sum + group._count._all, 0);

    const result = statusGroups.map((group: any) => ({
      status: group.status,
      count: group._count._all,
      percentage: total > 0 ? (group._count._all / total) * 100 : 0,
      color: statusColorMap.get(group.status) || '#6B7280',
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching status breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch status breakdown' },
      { status: 500 }
    );
  }
}

