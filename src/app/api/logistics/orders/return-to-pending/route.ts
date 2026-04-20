import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { syncLogisticsStatusToCrmOrders } from '@/lib/logistics-crm-sync';

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

        const placeholders = orderIds.map((_: string, i: number) => `$${i + 1}`).join(',');

        // Verify orders exist
        const currentOrders = await prisma.$queryRawUnsafe<{ crm_order_id: string; status: string; billed_week_id: number | null; finalized_at: string | null }[]>(`
            SELECT lm.crm_order_id, lm.status, lm.billed_week_id, bw.finalized_at
            FROM lm_orders lm
            LEFT JOIN lm_billing_weeks bw ON bw.id = lm.billed_week_id
            WHERE lm.crm_order_id IN (${placeholders})
        `, ...orderIds);

        const finalized = currentOrders.filter(o => o.finalized_at !== null);
        if (finalized.length > 0) {
            return NextResponse.json({
                error: `${finalized.length} orden(es) pertenecen a una semana ya finalizada. No se pueden modificar.`,
                finalizedIds: finalized.map(o => o.crm_order_id)
            }, { status: 400 });
        }

        // Return to Pendiente: clear billing, archive, and completion data
        await prisma.$executeRawUnsafe(`
            UPDATE lm_orders
            SET status = 'Pendiente',
                billed_week_id = NULL, billed_at = NULL,
                archived_at = NULL,
                completed_at = NULL, completed_by = NULL
            WHERE crm_order_id IN (${placeholders})
        `, ...orderIds);

        await syncLogisticsStatusToCrmOrders(prisma, orderIds, 'Pendiente', { allowNonTerminal: true });

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
