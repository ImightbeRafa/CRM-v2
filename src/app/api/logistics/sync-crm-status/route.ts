import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
    mapLogisticsStatusToCrmStatus,
    syncLogisticsStatusToCrmOrders,
} from '@/lib/logistics-crm-sync';

/**
 * POST /api/logistics/sync-crm-status
 * Updates the main CRM order status from the logistics dashboard.
 * Bypasses tenant isolation because logistics admin manages orders across tenants.
 * Body: { orderId: string (UUID), lmStatus: string }
 */
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const { orderId, lmStatus } = await req.json();
    if (!orderId || !lmStatus) {
        return NextResponse.json({ error: 'orderId and lmStatus required' }, { status: 400 });
    }

    const crmStatus = mapLogisticsStatusToCrmStatus(lmStatus);
    if (!crmStatus) {
        return NextResponse.json({ error: `No CRM mapping for lmStatus: ${lmStatus}` }, { status: 400 });
    }

    try {
        // Direct prisma update bypasses tenant context intentionally for cross-tenant logistics admin.
        const sync = await syncLogisticsStatusToCrmOrders(prisma, [orderId], lmStatus, { allowNonTerminal: true });
        if (sync.count === 0) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const updated = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, orderId: true, status: true, tenantId: true },
        });

        console.log(`[logistics/sync-crm-status] Order ${updated?.orderId ?? orderId} (tenant ${updated?.tenantId ?? 'unknown'}): status -> ${crmStatus}`);
        return NextResponse.json({ success: true, orderId: updated?.orderId ?? orderId, crmStatus });
    } catch (e) {
        console.error('[logistics/sync-crm-status]', e);
        return NextResponse.json({ error: 'Failed to sync status' }, { status: 500 });
    }
}
