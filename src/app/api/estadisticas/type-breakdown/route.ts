import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

const typeCache = new Map<string, { data: any; timestamp: number }>();
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
    
    // Check cache
    const cacheKey = `${tenantId}-${startDate}-${endDate}`;
    const cached = typeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }
    
    const prisma = getTenantPrisma(tenantId);

    // Build date filter - use saleDate when available, fallback to timestamp
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
      const saleDateFilter = {
        gte: dateFilter.gte?.toISOString(),
        lte: dateFilter.lte?.toISOString()
      };
      whereClause.OR = [
        { saleDate: saleDateFilter },
        { saleDate: null, timestamp: dateFilter }
      ];
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

    const result = {
      EA: {
        count: eaOrders._count._all,
        revenue: eaOrders._sum.total || 0,
      },
      RA: {
        count: raOrders._count._all,
        revenue: raOrders._sum.total || 0,
      },
    };
    
    // Store in cache
    typeCache.set(cacheKey, { data: result, timestamp: Date.now() });
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching type breakdown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order type breakdown' },
      { status: 500 }
    );
  }
}

