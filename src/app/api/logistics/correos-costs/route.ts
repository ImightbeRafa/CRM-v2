import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

/**
 * GET /api/logistics/correos-costs?tenantId=&dateFrom=&dateTo=
 *
 * Returns all Correos CR orders with status 'Entregado', enriched with
 * CRM order data. Each row includes correos_shipping_cost (null = pending input).
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get('tenantId');
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo = url.searchParams.get('dateTo');

        let dateSql = '';
        const params: any[] = [];
        if (tenantId) { params.push(tenantId); dateSql += ` AND lm.crm_tenant_id = $${params.length}`; }
        if (dateFrom) { params.push(dateFrom); dateSql += ` AND o.timestamp >= $${params.length}::timestamptz`; }
        if (dateTo) { params.push(dateTo); dateSql += ` AND o.timestamp <= $${params.length}::timestamptz + interval '1 day' - interval '1 second'`; }

        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT
                o.id,
                o."orderId",
                o."customerName",
                o."tenantId",
                o.total,
                o.timestamp,
                o.province,
                o.canton,
                lm.carrier,
                lm.status,
                lm.correos_shipping_cost
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE lm.carrier = 'correos'
              AND lm.status = 'Entregado'
              ${dateSql}
            ORDER BY o.timestamp DESC
        `, ...params);

        const totalOrders = orders.length;
        const withCost = orders.filter(o => o.correos_shipping_cost != null);
        const pendingCost = orders.filter(o => o.correos_shipping_cost == null);
        const totalCost = withCost.reduce((s: number, o: any) => s + Number(o.correos_shipping_cost), 0);

        return NextResponse.json({
            orders,
            summary: {
                totalOrders,
                withCostCount: withCost.length,
                pendingCostCount: pendingCost.length,
                totalCost,
            },
        });
    } catch (error) {
        console.error('[correos-costs GET]', error);
        return NextResponse.json({ error: 'Failed to fetch correos costs' }, { status: 500 });
    }
}

/**
 * PATCH /api/logistics/correos-costs
 * Body: { orderId: string, cost: number }
 *
 * Sets the correos_shipping_cost for a specific order (by CRM order id).
 */
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const { orderId, cost } = await req.json();
        if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });
        if (cost == null || isNaN(Number(cost)) || Number(cost) < 0) {
            return NextResponse.json({ error: 'Valid cost required (>= 0)' }, { status: 400 });
        }

        await prisma.$executeRaw`
            UPDATE lm_orders
            SET correos_shipping_cost = ${Number(cost)}, updated_at = NOW()
            WHERE crm_order_id = ${orderId}
        `;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[correos-costs PATCH]', error);
        return NextResponse.json({ error: 'Failed to update correos cost' }, { status: 500 });
    }
}
