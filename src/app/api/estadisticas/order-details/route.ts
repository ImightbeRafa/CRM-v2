import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { buildStatsOrderDateWhere } from '@/lib/statistics-dates';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req);
    if (!auth.ok) return auth.response;
    const tenantId = auth.tenantId;

    const { searchParams } = new URL(req.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const requestedLimit = parseInt(searchParams.get('limit') || '200', 10);
    const take = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 200));
    
    const prisma = getTenantPrisma(tenantId);

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    // Fetch all orders in the date range
    const orders = await prisma.order.findMany({
      where: {
        tenantId,
        ...buildStatsOrderDateWhere(startDate, endDate),
      },
      select: {
        id: true,
        orderId: true,
        orderType: true,
        status: true,
        customerName: true,
        total: true,
        saleDate: true,
        seller: true,
        salesChannel: true,
        timestamp: true,
      },
      orderBy: [
        { saleDate: 'desc' },
        { timestamp: 'desc' },
      ],
      take,
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
      seller: order.seller || null,
      salesChannel: order.salesChannel || null,
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
