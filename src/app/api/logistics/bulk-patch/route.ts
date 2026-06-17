import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { syncLogisticsStatusToCrmOrders } from '@/lib/logistics-crm-sync';

const VALID_LM_STATUSES = new Set(['Pendiente', 'En Proceso', 'Guía Creada', 'Impreso', 'En Tránsito', 'Entregado', 'Devuelto']);
const VALID_LM_CARRIERS = new Set(['mensajeria', 'correos', 'retiro']);

// POST /api/logistics/bulk-patch
// Body: { orderIds: string[], patch: { lmCarrier?, lmStatus? } }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const session = await getServerSession(authOptions);
    const actor = session?.user?.email ?? 'unknown';

    const body = await req.json();
    const { orderIds, patch } = body as {
        orderIds: string[];
        patch: { lmCarrier?: string | null; lmStatus?: string };
    };
    const uniqueOrderIds = Array.isArray(orderIds)
        ? [...new Set(orderIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map(id => id.trim()))]
        : [];
    const hasCarrierPatch = !!patch && Object.prototype.hasOwnProperty.call(patch, 'lmCarrier');
    const hasStatusPatch = !!patch && Object.prototype.hasOwnProperty.call(patch, 'lmStatus');

    if (!uniqueOrderIds.length) return NextResponse.json({ error: 'orderIds required' }, { status: 400 });
    if (uniqueOrderIds.length > 200) return NextResponse.json({ error: 'Maximum 200 orders per batch' }, { status: 400 });
    if (!patch || (!hasCarrierPatch && !hasStatusPatch)) {
        return NextResponse.json({ error: 'At least one field to patch required' }, { status: 400 });
    }
    if (hasStatusPatch && (!patch.lmStatus || !VALID_LM_STATUSES.has(patch.lmStatus))) {
        return NextResponse.json({ error: 'Invalid logistics status' }, { status: 400 });
    }
    if (hasCarrierPatch && patch.lmCarrier !== null && (!patch.lmCarrier || !VALID_LM_CARRIERS.has(patch.lmCarrier))) {
        return NextResponse.json({ error: 'Invalid logistics carrier' }, { status: 400 });
    }

    try {
        const crmOrders = await prisma.order.findMany({
            where: { id: { in: uniqueOrderIds } },
            select: { id: true, tenantId: true },
        });
        if (crmOrders.length !== uniqueOrderIds.length) {
            const foundIds = new Set(crmOrders.map(o => o.id));
            const missing = uniqueOrderIds.filter(id => !foundIds.has(id));
            return NextResponse.json({
                error: 'One or more orders were not found',
                missing,
            }, { status: 404 });
        }

        if (patch.lmStatus === 'Entregado') {
            const blocked = await prisma.$queryRaw<{ id: string; order_ref: string | null }[]>`
                SELECT o.id, o."orderId" AS order_ref
                FROM "Order" o
                LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
                WHERE o.id = ANY(${uniqueOrderIds}::text[])
                  AND (COALESCE(o."contraEntrega", FALSE) = TRUE OR COALESCE(lm.is_contra_entrega, FALSE) = TRUE)
                  AND (COALESCE(o."cePaymentConfirmed", FALSE) = FALSE AND COALESCE(lm.contraentrega_collected, FALSE) = FALSE)
            `;
            if (blocked.length > 0) {
                return NextResponse.json({
                    error: `${blocked.length} contra entrega order(s) require confirmed payment before Entregado`,
                    blocked: blocked.map(o => o.order_ref || o.id),
                }, { status: 400 });
            }
        }

        // Fetch current lm_orders rows
        const existing = await prisma.$queryRaw<{ crm_order_id: string }[]>`
            SELECT crm_order_id FROM lm_orders
            WHERE crm_order_id = ANY(${uniqueOrderIds}::text[])
        `;
        const existingIds = new Set(existing.map(r => r.crm_order_id));
        const toCreate = uniqueOrderIds.filter(id => !existingIds.has(id));

        // Update existing
        if (existingIds.size > 0) {
            const sets: string[] = ['updated_at=NOW()'];
            const params: any[] = [];
            if (patch.lmCarrier !== undefined) { params.push(patch.lmCarrier); sets.push(`carrier=$${params.length}`); }
            if (patch.lmStatus !== undefined) { params.push(patch.lmStatus); sets.push(`status=$${params.length}`); }

            if (patch.lmStatus !== undefined) {
                if (patch.lmStatus === 'Entregado') {
                    sets.push('completed_at=NOW()');
                    params.push(actor); sets.push(`completed_by=$${params.length}`);
                } else {
                    sets.push('completed_at=NULL');
                    sets.push('completed_by=NULL');
                }
            }

            params.push([...existingIds]);
            await prisma.$executeRawUnsafe(
                `UPDATE lm_orders SET ${sets.join(',')} WHERE crm_order_id = ANY($${params.length}::text[])`,
                ...params
            );
        }

        // Create missing rows
        if (toCreate.length > 0) {
            const completedAt = patch.lmStatus === 'Entregado' ? new Date() : null;
            const completedBy = patch.lmStatus === 'Entregado' ? actor : null;
            const ordersToCreate = crmOrders.filter(o => toCreate.includes(o.id));
            for (const o of ordersToCreate) {
                await prisma.$executeRaw`
                    INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, completed_at, completed_by)
                    VALUES (${o.id}, ${o.tenantId}, ${patch.lmCarrier ?? null}, ${patch.lmStatus ?? 'Pendiente'}, ${completedAt}, ${completedBy})
                    ON CONFLICT (crm_order_id) DO NOTHING
                `;
            }
        }

        if (patch.lmStatus !== undefined) {
            await syncLogisticsStatusToCrmOrders(prisma, uniqueOrderIds, patch.lmStatus);
        }

        // Log bulk event for each order
        const eventPayload = JSON.stringify({ ...patch, bulkCount: uniqueOrderIds.length });
        for (const orderId of uniqueOrderIds) {
            await prisma.$executeRaw`
                INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
                VALUES (${orderId}, 'bulk_update', ${eventPayload}::jsonb, ${actor})
            `;
        }

        return NextResponse.json({ success: true, updated: uniqueOrderIds.length });
    } catch (error) {
        console.error('[bulk-patch POST]', error);
        return NextResponse.json({ error: 'Bulk update failed' }, { status: 500 });
    }
}
