import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPI } from '@/lib/auth-helpers';
import { prismaRaw } from '@/lib/prisma-tenant';

export const dynamic = 'force-dynamic';

/**
 * DEBUG ENDPOINT - Remove after troubleshooting
 * This endpoint bypasses middleware to check raw database state
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    
    // Get orders using tenant-isolated client (with middleware)
    const tenantPrisma = getTenantPrisma(tenantId);
    const ordersWithMiddleware = await tenantPrisma.order.findMany({
      where: {},
      select: {
        id: true,
        orderId: true,
        customerName: true,
        status: true,
        tenantId: true,
        timestamp: true
      },
      orderBy: { timestamp: 'desc' },
      take: 10
    });
    
    // Get orders using raw client (WITHOUT middleware) - just for this tenant
    const ordersRaw = await prismaRaw.order.findMany({
      where: { tenantId },
      select: {
        id: true,
        orderId: true,
        customerName: true,
        status: true,
        tenantId: true,
        timestamp: true
      },
      orderBy: { timestamp: 'desc' },
      take: 10
    });
    
    // Get ALL orders from raw database (for comparison)
    const allOrdersRaw = await prismaRaw.order.findMany({
      select: {
        id: true,
        orderId: true,
        customerName: true,
        status: true,
        tenantId: true,
        timestamp: true
      },
      orderBy: { timestamp: 'desc' },
      take: 20
    });
    
    // Count by tenant
    const ordersByTenant = await prismaRaw.$queryRaw`
      SELECT "tenantId", COUNT(*)::int as count
      FROM "Order"
      GROUP BY "tenantId"
      ORDER BY count DESC
    `;
    
    return NextResponse.json({
      status: 'success',
      debug: {
        currentTenantId: tenantId,
        ordersWithMiddleware: {
          count: ordersWithMiddleware.length,
          orders: ordersWithMiddleware
        },
        ordersRawForThisTenant: {
          count: ordersRaw.length,
          orders: ordersRaw
        },
        allOrdersRaw: {
          count: allOrdersRaw.length,
          orders: allOrdersRaw
        },
        ordersByTenant,
        analysis: {
          middlewareWorking: ordersWithMiddleware.length === ordersRaw.length,
          potentialIssue: ordersWithMiddleware.length === 0 && ordersRaw.length > 0 
            ? 'MIDDLEWARE BLOCKING ORDERS' 
            : ordersRaw.length === 0 
              ? 'NO ORDERS IN DATABASE FOR THIS TENANT'
              : 'ORDERS LOADING CORRECTLY'
        }
      }
    });
  } catch (error) {
    console.error('[DEBUG] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: 'An error occurred'
    }, { status: 500 });
  }
}
