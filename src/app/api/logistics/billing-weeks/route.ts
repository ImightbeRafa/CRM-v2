import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/billing-weeks?status=all|finalized|open&limit=&offset=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'all';
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100);
    const offset = Number(url.searchParams.get('offset')) || 0;

    try {
        let whereClause = '';
        if (status === 'finalized') whereClause = 'WHERE bw.finalized_at IS NOT NULL';
        else if (status === 'open') whereClause = 'WHERE bw.finalized_at IS NULL';

        const weeks = await prisma.$queryRawUnsafe<any[]>(`
            SELECT
                bw.id, bw.week_start, bw.week_end, bw.finalized_at,
                bw.finalized_by, bw.notes, bw.created_at,
                COUNT(lm.id)::int AS order_count,
                COALESCE(SUM(o.total), 0)::float AS total_amount
            FROM lm_billing_weeks bw
            LEFT JOIN lm_orders lm ON lm.billed_week_id = bw.id
            LEFT JOIN "Order" o ON o.id = lm.crm_order_id
            ${whereClause}
            GROUP BY bw.id
            ORDER BY bw.week_start DESC
            LIMIT $1 OFFSET $2
        `, limit, offset);

        const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
            SELECT COUNT(*)::bigint AS count FROM lm_billing_weeks bw ${whereClause}
        `);
        const total = Number(countResult[0]?.count ?? 0);

        return NextResponse.json({ weeks, total, limit, offset });
    } catch (error) {
        console.error('[billing-weeks GET]', error);
        return NextResponse.json({ error: 'Failed to fetch billing weeks' }, { status: 500 });
    }
}

// POST /api/logistics/billing-weeks  — finalize a week
// Body: { weekStart: string (YYYY-MM-DD), weekEnd: string, orderIds: string[] }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const body = await req.json();
        const { weekStart, weekEnd, orderIds } = body;

        if (!weekStart || !weekEnd || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json(
                { error: 'weekStart, weekEnd, and non-empty orderIds[] required' },
                { status: 400 }
            );
        }

        const start = new Date(weekStart + 'T00:00:00');
        const end = new Date(weekEnd + 'T00:00:00');
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
            return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
        }

        if (start.getDay() !== 1) {
            return NextResponse.json({ error: 'weekStart must be a Monday' }, { status: 400 });
        }

        if (orderIds.length > 500) {
            return NextResponse.json({ error: 'Max 500 orders per finalization' }, { status: 400 });
        }

        // Check for existing finalized week (idempotent)
        const existing = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, finalized_at FROM lm_billing_weeks WHERE week_start = $1::date`,
            weekStart
        );

        if (existing.length > 0 && existing[0].finalized_at) {
            return NextResponse.json({
                error: 'Esta semana ya fue finalizada',
                weekId: existing[0].id
            }, { status: 409 });
        }

        // Validate all orders are Entregado and unbilled
        const placeholders = orderIds.map((_: string, i: number) => `$${i + 1}`).join(',');
        const eligibleOrders = await prisma.$queryRawUnsafe<{ crm_order_id: string }[]>(`
            SELECT crm_order_id FROM lm_orders
            WHERE crm_order_id IN (${placeholders})
              AND status = 'Entregado'
              AND billed_week_id IS NULL
        `, ...orderIds);

        const eligibleIds = new Set(eligibleOrders.map(o => o.crm_order_id));
        const ineligible = orderIds.filter((id: string) => !eligibleIds.has(id));

        if (ineligible.length > 0) {
            return NextResponse.json({
                error: `${ineligible.length} orden(es) no son elegibles (ya facturadas o no en estado Entregado)`,
                ineligibleIds: ineligible
            }, { status: 400 });
        }

        const actor = req.headers.get('x-user-email') ?? 'system';

        // Offset placeholders by +1 for queries where $1 = weekId
        const updatePlaceholders = orderIds.map((_: string, i: number) => `$${i + 2}`).join(',');

        let weekId: number;
        await prisma.$executeRawUnsafe('BEGIN');
        try {
            if (existing.length > 0) {
                weekId = existing[0].id;
                await prisma.$executeRawUnsafe(
                    `UPDATE lm_billing_weeks SET finalized_at = NOW(), finalized_by = $1 WHERE id = $2`,
                    actor, weekId
                );
            } else {
                const inserted = await prisma.$queryRawUnsafe<{ id: number }[]>(
                    `INSERT INTO lm_billing_weeks (week_start, week_end, finalized_at, finalized_by)
                     VALUES ($1::date, $2::date, NOW(), $3)
                     RETURNING id`,
                    weekStart, weekEnd, actor
                );
                weekId = inserted[0].id;
            }

            // Batch update orders — $1 = weekId, $2...$N+1 = orderIds
            await prisma.$executeRawUnsafe(`
                UPDATE lm_orders
                SET billed_week_id = $1, billed_at = NOW()
                WHERE crm_order_id IN (${updatePlaceholders})
                  AND billed_week_id IS NULL
            `, weekId, ...orderIds);

            // Batch insert events in a single query
            const payloadJson = JSON.stringify({ weekId, weekStart, weekEnd });
            const eventValues = orderIds.map((_: string, i: number) => {
                const base = i * 3;
                return `($${base + 1}, 'billed', $${base + 2}::jsonb, $${base + 3})`;
            }).join(', ');
            const eventParams = orderIds.flatMap((orderId: string) => [orderId, payloadJson, actor]);
            await prisma.$executeRawUnsafe(
                `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor) VALUES ${eventValues}`,
                ...eventParams
            );

            await prisma.$executeRawUnsafe('COMMIT');
        } catch (txError) {
            await prisma.$executeRawUnsafe('ROLLBACK');
            throw txError;
        }

        return NextResponse.json({
            success: true,
            weekId,
            billedCount: orderIds.length,
            weekStart,
            weekEnd
        });
    } catch (error) {
        console.error('[billing-weeks POST]', error);
        return NextResponse.json({ error: 'Failed to finalize billing week' }, { status: 500 });
    }
}
