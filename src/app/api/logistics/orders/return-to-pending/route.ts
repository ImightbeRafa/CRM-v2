import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// POST /api/logistics/orders/return-to-pending
// Body: { orderIds: string[], reason: string }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const body = await req.json();
        const { orderIds, reason } = body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: 'orderIds[] required' }, { status: 400 });
        }

        if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
            return NextResponse.json({ error: 'A reason is required (min 3 chars)' }, { status: 400 });
        }

        if (orderIds.length > 100) {
            return NextResponse.json({ error: 'Max 100 orders per request' }, { status: 400 });
        }

        // Verify orders exist and are currently Entregado
        const placeholders = orderIds.map((_: string, i: number) => `$${i + 1}`).join(',');
        const currentOrders = await prisma.$queryRawUnsafe<{ crm_order_id: string; status: string; billed_week_id: number | null }[]>(`
            SELECT crm_order_id, status, billed_week_id FROM lm_orders
            WHERE crm_order_id IN (${placeholders})
        `, ...orderIds);

        const billed = currentOrders.filter(o => o.billed_week_id !== null);
        if (billed.length > 0) {
            return NextResponse.json({
                error: `${billed.length} orden(es) ya estan facturadas. Debes revertir la semana primero.`,
                billedIds: billed.map(o => o.crm_order_id)
            }, { status: 400 });
        }

        // Update status to Pendiente
        await prisma.$executeRawUnsafe(`
            UPDATE lm_orders
            SET status = 'Pendiente'
            WHERE crm_order_id IN (${placeholders})
              AND billed_week_id IS NULL
        `, ...orderIds);

        // Batch insert events in a single query
        const actor = req.headers.get('x-user-email') ?? 'system';
        const payloadJson = JSON.stringify({ reason: reason.trim(), previousStatus: 'Entregado' });
        const eventValues = orderIds.map((_: string, i: number) => {
            const base = i * 3;
            return `($${base + 1}, 'returned_to_pending', $${base + 2}::jsonb, $${base + 3})`;
        }).join(', ');
        const eventParams = orderIds.flatMap((orderId: string) => [orderId, payloadJson, actor]);
        await prisma.$executeRawUnsafe(
            `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor) VALUES ${eventValues}`,
            ...eventParams
        );

        return NextResponse.json({
            success: true,
            updatedCount: orderIds.length
        });
    } catch (error) {
        console.error('[return-to-pending POST]', error);
        return NextResponse.json({ error: 'Failed to return orders to pending' }, { status: 500 });
    }
}
