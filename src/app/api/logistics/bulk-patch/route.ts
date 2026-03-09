import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

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
            params.push([...existingIds]);
            await prisma.$executeRawUnsafe(
                `UPDATE lm_orders SET ${sets.join(',')} WHERE crm_order_id = ANY($${params.length}::text[])`,
                ...params
            );
        }

        // Create missing rows
        if (toCreate.length > 0) {
            const crmOrders = await prisma.order.findMany({
                where: { id: { in: toCreate } },
                select: { id: true, tenantId: true },
            });
            for (const o of crmOrders) {
                await prisma.$executeRaw`
                    INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                    VALUES (${o.id}, ${o.tenantId}, ${patch.lmCarrier ?? null}, ${patch.lmStatus ?? 'Pendiente'})
                    ON CONFLICT (crm_order_id) DO NOTHING
                `;
            }
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
