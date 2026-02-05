import { NextRequest, NextResponse } from 'next/server';
import { prismaRaw } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * ADMIN ENDPOINT - Fix orders with wrong tenant ID
 * This endpoint allows moving orders from one tenant to another
 * USE WITH EXTREME CAUTION
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'manage_tenant');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const body = await request.json();
    
    const { orderIds, targetTenantId } = body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({
        status: 'error',
        error: 'orderIds array is required'
      }, { status: 400 });
    }
    
    // SECURITY: Validate and sanitize orderIds to prevent query injection
    // Each orderIds must be a string (not an object that could contain operators like $ne)
    const sanitizedOrderIds = orderIds.filter((id): id is string => 
      typeof id === 'string' && id.length > 0 && id.length < 100
    );
    
    if (sanitizedOrderIds.length !== orderIds.length) {
      return NextResponse.json({
        status: 'error',
        error: 'Invalid orderIds format - all IDs must be non-empty strings'
      }, { status: 400 });
    }
    
    if (!targetTenantId || typeof targetTenantId !== 'string') {
      return NextResponse.json({
        status: 'error',
        error: 'targetTenantId is required'
      }, { status: 400 });
    }
    
    // Security check: Only allow moving orders TO your current tenant
    if (targetTenantId !== tenantId) {
      return NextResponse.json({
        status: 'error',
        error: 'You can only move orders TO your current tenant'
      }, { status: 403 });
    }
    
    // Verify target tenant exists
    const targetTenant = await prismaRaw.tenant.findUnique({
      where: { id: targetTenantId }
    });
    
    if (!targetTenant) {
      return NextResponse.json({
        status: 'error',
        error: 'Target tenant not found'
      }, { status: 404 });
    }
    
    // Get orders to verify they exist
    const orders = await prismaRaw.order.findMany({
      where: {
        orderId: { in: sanitizedOrderIds }
      },
      select: {
        id: true,
        orderId: true,
        customerName: true,
        tenantId: true
      }
    });
    
    if (orders.length === 0) {
      return NextResponse.json({
        status: 'error',
        error: 'No orders found with provided IDs'
      }, { status: 404 });
    }
    
    console.log('🔧 [fix-tenant] Moving orders:', {
      fromTenants: [...new Set(orders.map(o => o.tenantId))],
      toTenant: targetTenantId,
      orderCount: orders.length,
      orderIds: orders.map(o => o.orderId)
    });
    
    // Update all orders to the new tenant
    const result = await prismaRaw.order.updateMany({
      where: {
        orderId: { in: sanitizedOrderIds }
      },
      data: {
        tenantId: targetTenantId
      }
    });
    
    console.log('✅ [fix-tenant] Orders moved successfully:', {
      updated: result.count,
      targetTenant: targetTenantId
    });
    
    return NextResponse.json({
      status: 'success',
      message: `Successfully moved ${result.count} order(s) to tenant ${targetTenantId}`,
      data: {
        updatedCount: result.count,
        orders: orders.map(o => ({
          orderId: o.orderId,
          customerName: o.customerName,
          oldTenantId: o.tenantId,
          newTenantId: targetTenantId
        }))
      }
    });
    
  } catch (error) {
    console.error('[fix-tenant] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
