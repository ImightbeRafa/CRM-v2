import { NextResponse } from 'next/server';
import { logUpdate } from '@/lib/auditLogger';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { readProductionServerReadiness, shouldUseOrderLifecycleV2 } from '@/lib/feature-flags';
import { lifecycleIdempotencyKey, OrderLifecycleError, setLifecycleOrderStatus } from '@/lib/order-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.orderId || !body.status) {
      return NextResponse.json({ error: 'Missing required fields: orderId, status' }, { status: 400 });
    }
    const auth = await authenticateAPIWithPermission(request as any, 'update_production');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role: userRole } = auth;

    return await withTenantContext({
      tenantId,
      userId,
      role: userRole,
      userRole,
      userName: 'Authenticated user',
    }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId);
      const existingOrder = await tenantPrisma.order.findFirst({ where: { orderId: body.orderId } });
      if (!existingOrder) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

      const productionV2 = await readProductionServerReadiness(tenantId);
      let destinationStatus = String(body.status);
      if (productionV2.enabled) {
        if (!body.expectedStatus || !body.expectedUpdatedAt || !body.idempotencyKey) {
          return NextResponse.json({
            error: 'expectedStatus, expectedUpdatedAt, and idempotencyKey are required',
            code: 'VERSION_REQUIRED',
          }, { status: 428 });
        }
        const destination = await tenantPrisma.orderStatus.findFirst({
          where: { isActive: true, label: { equals: destinationStatus, mode: 'insensitive' } },
          select: { label: true },
        });
        if (!destination) {
          return NextResponse.json({ error: 'Destination status is not active', code: 'INVALID_STATUS' }, { status: 400 });
        }
        destinationStatus = destination.label;
      }

      const staleResponse = async () => {
        const current = await tenantPrisma.order.findFirst({
          where: { id: existingOrder.id },
          select: { orderId: true, status: true, updatedAt: true },
        });
        return NextResponse.json({
          error: 'Order changed before this update',
          code: 'STALE_ORDER',
          current,
        }, { status: 409 });
      };

      const useLifecycleV2 = await shouldUseOrderLifecycleV2(tenantId, 'production-status');
      let updatedOrder;
      if (useLifecycleV2) {
        try {
          const lifecycle = await setLifecycleOrderStatus({
            tenantId,
            userId,
            adapter: 'production-status',
            idempotencyKey: body.idempotencyKey || lifecycleIdempotencyKey(
              request,
              `production-status:${existingOrder.id}:${destinationStatus}:${existingOrder.updatedAt.toISOString()}`,
            ),
            orderId: existingOrder.orderId,
            status: destinationStatus,
            expectedStatus: productionV2.enabled ? String(body.expectedStatus) : undefined,
            expectedUpdatedAt: productionV2.enabled ? String(body.expectedUpdatedAt) : undefined,
          });
          updatedOrder = lifecycle.order;
        } catch (error) {
          if (error instanceof OrderLifecycleError) {
            if (error.code === 'STALE_ORDER') return staleResponse();
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
          }
          throw error;
        }
      } else if (productionV2.enabled) {
        const expectedUpdatedAt = new Date(String(body.expectedUpdatedAt));
        if (Number.isNaN(expectedUpdatedAt.getTime())) {
          return NextResponse.json({ error: 'Invalid expectedUpdatedAt' }, { status: 400 });
        }
        const changed = await tenantPrisma.order.updateMany({
          where: {
            id: existingOrder.id,
            status: String(body.expectedStatus),
            updatedAt: expectedUpdatedAt,
          },
          data: { status: destinationStatus },
        });
        if (changed.count !== 1) return staleResponse();
        updatedOrder = await tenantPrisma.order.findFirst({ where: { id: existingOrder.id } });
      } else {
        updatedOrder = await tenantPrisma.order.update({
          where: { id: existingOrder.id },
          data: { status: destinationStatus },
        });
      }

      if (!useLifecycleV2 && updatedOrder) {
        try {
          await logUpdate(
            request as any,
            'order',
            updatedOrder.id,
            `Order #${body.orderId}`,
            { status: existingOrder.status, changes: [`Estado: "${existingOrder.status}" → "${destinationStatus}"`] },
            { status: destinationStatus },
          );
        } catch (auditError) {
          console.error('[orders/status] Audit logging failed (non-fatal):', auditError);
        }
      }
      return NextResponse.json({ success: true, data: updatedOrder });
    });
  } catch (error) {
    console.error('[orders/status] Error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: process.env.NODE_ENV !== 'production' && error instanceof Error ? error.message : undefined,
    }, { status: 500 });
  }
}
