import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// GET /api/logistics/contra-entrega?tenantId=&dateFrom=&dateTo=&collected=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const collectedFilter = url.searchParams.get('collected'); // 'true' | 'false' | null

    try {
        // Build date clause
        let dateSql = '';
        const params: any[] = [];
        if (dateFrom) { params.push(dateFrom); dateSql += ` AND o.timestamp >= $${params.length}::timestamptz`; }
        if (dateTo) { params.push(dateTo); dateSql += ` AND o.timestamp <= $${params.length}::timestamptz`; }

        // We always filter by is_contra_entrega = true
        let ceSql = '';
        if (collectedFilter === 'true') ceSql = ' AND lm.contraentrega_collected = TRUE';
        else if (collectedFilter === 'false') ceSql = ' AND lm.contraentrega_collected = FALSE';

        let tenantSql = '';
        if (tenantId) { params.push(tenantId); tenantSql = ` AND o."tenantId" = $${params.length}`; }

        const rows = await prisma.$queryRawUnsafe<any[]>(`
            SELECT
                o.id            AS "orderId",
                o."orderId"     AS "orderRef",
                o."tenantId"    AS "tenantId",
                o."customerName",
                o.phone,
                o.total,
                o.timestamp,
                o.province,
                lm.carrier      AS "lmCarrier",
                lm.status       AS "lmStatus",
                lm.is_contra_entrega    AS "isContraEntrega",
                lm.contraentrega_collected AS "collected"
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE lm.is_contra_entrega = TRUE
            ${dateSql}${ceSql}${tenantSql}
            ORDER BY o.timestamp DESC
            LIMIT 500
        `, ...params);

        // Fetch any confirmed payment records for these orders
        const orderIds = rows.map((r) => r.orderId);
        let payments: any[] = [];
        if (orderIds.length > 0) {
            payments = await prisma.$queryRaw<any[]>`
                SELECT crm_order_id, amount, collected_at, notes, confirmed_by
                FROM lm_ce_payments
                WHERE crm_order_id = ANY(${orderIds}::text[])
                ORDER BY collected_at DESC
            `;
        }

        const paymentMap: Record<string, any[]> = {};
        for (const p of payments) {
            if (!paymentMap[p.crm_order_id]) paymentMap[p.crm_order_id] = [];
            paymentMap[p.crm_order_id].push(p);
        }

        const enriched = rows.map((r) => ({
            ...r,
            payments: paymentMap[r.orderId] || [],
        }));

        const totalAmount = enriched.reduce((s, r) => s + Number(r.total ?? 0), 0);
        const pending = enriched.filter((r) => !r.collected).length;
        const collected = enriched.filter((r) => r.collected).length;

        return NextResponse.json({
            orders: enriched,
            summary: { total: enriched.length, totalAmount, pending, collected },
        });
    } catch (error) {
        console.error('[contra-entrega GET]', error);
        return NextResponse.json({ error: 'Failed to fetch CE orders' }, { status: 500 });
    }
}

// POST /api/logistics/contra-entrega — confirm a payment
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const session = await getServerSession(authOptions);
    const actor = session?.user?.email ?? 'unknown';

    const body = await req.json();
    const { orderId, tenantId, amount, notes } = body;

    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

    try {
        // Mark as collected on lm_orders
        await prisma.$executeRaw`
            UPDATE lm_orders SET contraentrega_collected = TRUE, updated_at = NOW()
            WHERE crm_order_id = ${orderId}
        `;

        // Record the payment
        await prisma.$executeRaw`
            INSERT INTO lm_ce_payments (crm_order_id, crm_tenant_id, amount, notes, confirmed_by)
            VALUES (${orderId}, ${tenantId ?? ''}, ${amount ?? 0}, ${notes ?? null}, ${actor})
        `;

        // Log event
        await prisma.$executeRaw`
            INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
            VALUES (${orderId}, 'ce_confirmed', ${JSON.stringify({ amount, notes })}::jsonb, ${actor})
        `;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[contra-entrega POST]', error);
        return NextResponse.json({ error: 'Failed to confirm CE payment' }, { status: 500 });
    }
}
