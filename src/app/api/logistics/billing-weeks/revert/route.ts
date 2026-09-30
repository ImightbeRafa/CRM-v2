import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// POST /api/logistics/billing-weeks/revert
// Body: { weekId: number, confirmToken: "REVERTIR" }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const body = await req.json();
        const { weekId, confirmToken } = body;

        if (!weekId || typeof weekId !== 'number') {
            return NextResponse.json({ error: 'weekId (number) required' }, { status: 400 });
        }

        if (confirmToken !== 'REVERTIR') {
            return NextResponse.json(
                { error: 'Debes escribir REVERTIR para confirmar' },
                { status: 400 }
            );
        }

        // Verify week exists
        const week = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, week_start, week_end, finalized_at FROM lm_billing_weeks WHERE id = $1`,
            weekId
        );

        if (week.length === 0) {
            return NextResponse.json({ error: 'Semana no encontrada' }, { status: 404 });
        }

        // Count affected orders
        const actor = req.headers.get('x-user-email') ?? 'system';

        // ONE interactive transaction (a single pooled connection); the affected orders are read and
        // locked inside it. The old raw BEGIN/COMMIT on the shared client only worked while the pool
        // had exactly one connection (perf review 2026-09-30).
        const affectedCount = await prisma.$transaction(async (tx) => {
            const affectedOrders = await tx.$queryRawUnsafe<{ crm_order_id: string }[]>(
                `SELECT crm_order_id FROM lm_orders WHERE billed_week_id = $1 FOR UPDATE`,
                weekId
            );

            // Unbill all orders for this week
            await tx.$executeRawUnsafe(
                `UPDATE lm_orders SET billed_week_id = NULL, billed_at = NULL WHERE billed_week_id = $1`,
                weekId
            );

            // Delete the week record
            await tx.$executeRawUnsafe(
                `DELETE FROM lm_billing_weeks WHERE id = $1`,
                weekId
            );

            // Batch insert revert events
            if (affectedOrders.length > 0) {
                const payloadJson = JSON.stringify({
                    weekId,
                    weekStart: week[0].week_start,
                    weekEnd: week[0].week_end
                });
                const eventValues = affectedOrders.map((_: any, i: number) => {
                    const base = i * 3;
                    return `($${base + 1}, 'billing_reverted', $${base + 2}::jsonb, $${base + 3})`;
                }).join(', ');
                const eventParams = affectedOrders.flatMap((o: any) => [o.crm_order_id, payloadJson, actor]);
                await tx.$executeRawUnsafe(
                    `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor) VALUES ${eventValues}`,
                    ...eventParams
                );
            }
            return affectedOrders.length;
        }, { timeout: 30_000, maxWait: 10_000 });

        return NextResponse.json({
            success: true,
            revertedOrders: affectedCount,
            weekId
        });
    } catch (error) {
        console.error('[billing-weeks revert]', error);
        return NextResponse.json({ error: 'Failed to revert billing week' }, { status: 500 });
    }
}
