import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { syncLogisticsStatusToCrmOrders } from '@/lib/logistics-crm-sync';

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
        patch: { lmCarrier?: string; lmStatus?: string };
    };

    if (!orderIds?.length) return NextResponse.json({ error: 'orderIds required' }, { status: 400 });
    if (orderIds.length > 200) return NextResponse.json({ error: 'Maximum 200 orders per batch' }, { status: 400 });
    if (!patch || (!patch.lmCarrier && !patch.lmStatus)) {
        return NextResponse.json({ error: 'At least one field to patch required' }, { status: 400 });
    }

    try {
        if (patch.lmStatus === 'Entregado') {
            const blocked = await prisma.$queryRaw<{ id: string; order_ref: string | null }[]>`
                SELECT o.id, o."orderId" AS order_ref
                FROM "Order" o
                LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
                WHERE o.id = ANY(${orderIds}::text[])
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
            WHERE crm_order_id = ANY(${orderIds}::text[])
        `;
        const existingIds = new Set(existing.map(r => r.crm_order_id));
        const toCreate = orderIds.filter(id => !existingIds.has(id));

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
            const crmOrders = await prisma.order.findMany({
                where: { id: { in: toCreate } },
                select: { id: true, tenantId: true },
            });
            for (const o of crmOrders) {
                await prisma.$executeRaw`
                    INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, completed_at, completed_by)
                    VALUES (${o.id}, ${o.tenantId}, ${patch.lmCarrier ?? null}, ${patch.lmStatus ?? 'Pendiente'}, ${completedAt}, ${completedBy})
                    ON CONFLICT (crm_order_id) DO NOTHING
                `;
            }
        }

        if (patch.lmStatus !== undefined) {
            await syncLogisticsStatusToCrmOrders(prisma, orderIds, patch.lmStatus);
        }

        // Log bulk event for each order
        const eventPayload = JSON.stringify({ ...patch, bulkCount: orderIds.length });
        for (const orderId of orderIds) {
            await prisma.$executeRaw`
                INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
                VALUES (${orderId}, 'bulk_update', ${eventPayload}::jsonb, ${actor})
            `;
        }

        return NextResponse.json({ success: true, updated: orderIds.length });
    } catch (error) {
        console.error('[bulk-patch POST]', error);
        return NextResponse.json({ error: 'Bulk update failed' }, { status: 500 });
    }
}
