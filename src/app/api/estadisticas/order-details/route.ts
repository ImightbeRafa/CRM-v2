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

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    
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

    // Fetch all orders in the date range
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
        id: true,
        orderId: true,
        orderType: true,
        status: true,
        customerName: true,
        total: true,
        saleDate: true,
        timestamp: true,
      },
      orderBy: [
        { saleDate: 'desc' },
        { timestamp: 'desc' },
      ],
    });

    // Transform the data
    const result = orders.map((order: any) => ({
      id: order.id,
      orderId: order.orderId,
      orderType: order.orderType || 'EA',
      status: order.status || 'Pendiente',
      customerName: order.customerName || 'Sin nombre',
      total: order.total || 0,
      saleDate: order.saleDate,
      timestamp: order.timestamp?.toISOString() || new Date().toISOString(),
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching order details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order details' },
      { status: 500 }
    );
  }
}
