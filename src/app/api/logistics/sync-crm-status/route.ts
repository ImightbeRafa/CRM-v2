import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// Logistics → CRM status mapping
const LM_TO_CRM_STATUS: Record<string, string> = {
    'Pendiente': 'Pendiente',
    'En Proceso': 'En Proceso',
    'En Tránsito': 'Enviado',
    'Entregado': 'Completado',
    'Devuelto': 'Devuelto',
};

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

    const crmStatus = LM_TO_CRM_STATUS[lmStatus];
    if (!crmStatus) {
        return NextResponse.json({ error: `No CRM mapping for lmStatus: ${lmStatus}` }, { status: 400 });
    }

    try {
        // Direct prisma update — bypasses tenant context intentionally for cross-tenant logistics admin
        const updated = await prisma.order.update({
            where: { id: orderId },
            data: { status: crmStatus },
            select: { id: true, orderId: true, status: true, tenantId: true },
        });

        console.log(`[logistics/sync-crm-status] Order ${updated.orderId} (tenant ${updated.tenantId}): status → ${crmStatus}`);
        return NextResponse.json({ success: true, orderId: updated.orderId, crmStatus });
    } catch (e) {
        console.error('[logistics/sync-crm-status]', e);
        return NextResponse.json({ error: 'Failed to sync status' }, { status: 500 });
    }
}
