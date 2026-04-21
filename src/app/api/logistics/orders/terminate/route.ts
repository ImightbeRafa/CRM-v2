import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { syncLogisticsStatusToCrmOrders } from '@/lib/logistics-crm-sync';
import { getCorreosAutomatedShippingCost } from '@/lib/correos-gam-pricing';

const CR_TZ = 'America/Costa_Rica';

function getMondayCR(): string {
    const now = new Date();
    const crStr = now.toLocaleDateString('en-CA', { timeZone: CR_TZ });
    const [y, m, d] = crStr.split('-').map(Number);
    const crDate = new Date(y, m - 1, d);
    const day = crDate.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    crDate.setDate(crDate.getDate() + diff);
    const yy = crDate.getFullYear();
    const mm = String(crDate.getMonth() + 1).padStart(2, '0');
    const dd = String(crDate.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function getSundayCR(monday: string): string {
    const [y, m, d] = monday.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 6);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/**
 * POST /api/logistics/orders/terminate
 *
 * Atomically terminates orders: assigns them to the current billing week,
 * archives them, and optionally saves Correos shipping costs.
 *
 * Body: { orderIds: string[], correosCosts?: Record<string, number> }
 */
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const actor = req.headers.get('x-user-email') ?? 'system';

    try {
        const body = await req.json();
        const { orderIds, correosCosts } = body as {
            orderIds: string[];
            correosCosts?: Record<string, number>;
        };

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({ error: 'orderIds[] required' }, { status: 400 });
        }
        if (orderIds.length > 200) {
            return NextResponse.json({ error: 'Maximum 200 orders per request' }, { status: 400 });
        }

        const placeholders = orderIds.map((_: string, i: number) => `$${i + 1}`).join(',');
        const orders = await prisma.$queryRawUnsafe<{
            crm_order_id: string; carrier: string | null;
            status: string; billed_week_id: number | null;
            correos_shipping_cost: number | null;
            archived_at: Date | null;
            province: string | null;
            canton: string | null;
        }[]>(
            `SELECT lm.crm_order_id, lm.carrier, lm.status, lm.billed_week_id, lm.correos_shipping_cost, lm.archived_at,
                    o.province, o.canton
             FROM lm_orders lm
             LEFT JOIN "Order" o ON o.id = lm.crm_order_id
             WHERE lm.crm_order_id IN (${placeholders})`,
            ...orderIds
        );

        const orderMap = new Map(orders.map(o => [o.crm_order_id, o]));
        const automatedCorreosCosts: Record<string, number> = {};
        const automatedCorreosCostMeta: Record<string, { zone: string; reason: string }> = {};

        // Orders that were previously billed but then restored (archived_at cleared).
        // These only need re-archiving, not re-billing.
        const rearchiveIds: string[] = [];

        const errors: string[] = [];
        for (const id of orderIds) {
            const o = orderMap.get(id);
            if (!o) { errors.push(`${id}: no existe en logistics`); continue; }
            if (o.status !== 'Entregado' && o.status !== 'Devuelto') { errors.push(`${id}: estado ${o.status}, se requiere Entregado o Devuelto`); continue; }
            if (o.billed_week_id != null) {
                if (o.archived_at == null) {
                    // Restored order — already billed, just needs re-archiving
                    rearchiveIds.push(id);
                } else {
                    errors.push(`${id}: ya facturada y archivada`);
                }
                continue;
            }
            if (o.carrier === 'correos' && o.status === 'Entregado') {
                const existingCost = o.correos_shipping_cost;
                const providedCost = correosCosts?.[id];
                if (existingCost == null) {
                    if (providedCost != null && !isNaN(providedCost) && providedCost >= 0) {
                        automatedCorreosCosts[id] = Number(providedCost);
                        automatedCorreosCostMeta[id] = { zone: 'manual', reason: 'Costo enviado en request' };
                        continue;
                    }

                    const calculated = getCorreosAutomatedShippingCost({
                        province: o.province,
                        canton: o.canton,
                    });

                    if (calculated.cost == null || !calculated.zone) {
                        errors.push(`${id}: no se pudo calcular costo Correos (${calculated.reason})`);
                        continue;
                    }

                    automatedCorreosCosts[id] = calculated.cost;
                    automatedCorreosCostMeta[id] = {
                        zone: calculated.zone,
                        reason: calculated.reason,
                    };
                }
            }
        }

        // Filter out rearchive IDs from the main billing flow
        const freshIds = orderIds.filter(id => !rearchiveIds.includes(id) && !errors.some(e => e.startsWith(id)));

        if (errors.length > 0 && freshIds.length === 0 && rearchiveIds.length === 0) {
            return NextResponse.json({ error: 'Órdenes inválidas', details: errors }, { status: 400 });
        }

        const monday = getMondayCR();
        const sunday = getSundayCR(monday);

        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.$queryRawUnsafe<{ id: number }[]>(
                `SELECT id FROM lm_billing_weeks WHERE week_start = $1::date`, monday
            );

            let weekId: number;
            if (existing.length > 0) {
                weekId = existing[0].id;
            } else {
                const inserted = await tx.$queryRawUnsafe<{ id: number }[]>(
                    `INSERT INTO lm_billing_weeks (week_start, week_end)
                     VALUES ($1::date, $2::date)
                     ON CONFLICT (week_start) DO UPDATE SET week_end = EXCLUDED.week_end
                     RETURNING id`,
                    monday, sunday
                );
                weekId = inserted[0].id;
            }

            // --- Fresh orders: full billing + archiving ---
            if (freshIds.length > 0) {
                const nonCorreosIds = freshIds.filter((id: string) => {
                    const o = orderMap.get(id)!;
                    return !(o.carrier === 'correos' && automatedCorreosCosts[id] != null);
                });
                if (nonCorreosIds.length > 0) {
                    await tx.$executeRawUnsafe(
                        `UPDATE lm_orders
                         SET billed_week_id = $1, billed_at = NOW(), archived_at = NOW()
                         WHERE crm_order_id = ANY($2::text[]) AND billed_week_id IS NULL`,
                        weekId, nonCorreosIds
                    );
                }

                const correosWithCost = freshIds.filter((id: string) => {
                    const o = orderMap.get(id)!;
                    return o.carrier === 'correos' && automatedCorreosCosts[id] != null;
                });
                for (const id of correosWithCost) {
                    await tx.$executeRawUnsafe(
                        `UPDATE lm_orders
                         SET billed_week_id = $1, billed_at = NOW(), archived_at = NOW(),
                             correos_shipping_cost = $2
                         WHERE crm_order_id = $3 AND billed_week_id IS NULL`,
                        weekId, automatedCorreosCosts[id], id
                    );
                }
            }

            // --- Re-archive orders: already billed, just set archived_at ---
            if (rearchiveIds.length > 0) {
                await tx.$executeRawUnsafe(
                    `UPDATE lm_orders
                     SET archived_at = NOW()
                     WHERE crm_order_id = ANY($1::text[]) AND archived_at IS NULL`,
                    rearchiveIds
                );
            }

            // --- Log events for all processed orders ---
            const allProcessedIds = [...freshIds, ...rearchiveIds];
            const deliveredIds = allProcessedIds.filter((id) => orderMap.get(id)?.status === 'Entregado');
            const returnedIds = allProcessedIds.filter((id) => orderMap.get(id)?.status === 'Devuelto');
            if (deliveredIds.length > 0) {
                await syncLogisticsStatusToCrmOrders(tx, deliveredIds, 'Entregado');
            }
            if (returnedIds.length > 0) {
                await syncLogisticsStatusToCrmOrders(tx, returnedIds, 'Devuelto');
            }

            const payloadJson = JSON.stringify({
                weekId,
                weekStart: monday,
                weekEnd: sunday,
                automatedCorreosCosts,
                automatedCorreosCostMeta,
            });
            const eventValues = allProcessedIds.map((_: string, i: number) => {
                const base = i * 3;
                return `($${base + 1}, 'terminated', $${base + 2}::jsonb, $${base + 3})`;
            }).join(', ');
            const eventParams = allProcessedIds.flatMap((id: string) => [id, payloadJson, actor]);
            if (allProcessedIds.length > 0) {
                await tx.$executeRawUnsafe(
                    `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor) VALUES ${eventValues}`,
                    ...eventParams
                );
            }

            return { weekId, billedCount: freshIds.length, rearchivedCount: rearchiveIds.length, weekStart: monday, weekEnd: sunday, automatedCorreosCosts };
        });

        return NextResponse.json({ success: true, ...result });
    } catch (error: any) {
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        console.error('[terminate POST]', error);
        return NextResponse.json({ error: 'Failed to terminate orders' }, { status: 500 });
    }
}
