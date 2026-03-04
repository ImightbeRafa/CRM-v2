import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

// GET /api/logistics/reports?tenantId=&dateFrom=&dateTo=
// Returns structured report data matching spreadsheet format
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const staffName = url.searchParams.get('staffName') ?? 'Marlenn';

    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    try {
        // 1. Fetch rates config
        const rateRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('mensajeria_rate','correos_rate','handling_rate','salary_daily_rate','gd_recoleccion_cost')
        `;
        const cfg: Record<string, number> = {};
        for (const r of rateRows) cfg[r.key] = Number(r.value) || 0;

        const mensajeriaRate = cfg['mensajeria_rate'] ?? 2600;
        const correosRate = cfg['correos_rate'] ?? 2500;
        const handlingRate = cfg['handling_rate'] ?? 600;
        const salaryRate = cfg['salary_daily_rate'] ?? 10000;
        const gdRecoleccionCost = cfg['gd_recoleccion_cost'] ?? 2700;

        // 2. Fetch orders in date range for this tenant
        let dateSql = '';
        const params: any[] = [tenantId];
        if (dateFrom) { params.push(dateFrom); dateSql += ` AND o.timestamp >= $${params.length}::timestamptz`; }
        if (dateTo) { params.push(dateTo); dateSql += ` AND o.timestamp <= $${params.length}::timestamptz + interval '1 day' - interval '1 second'`; }

        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT
                o.id, o."orderId", o."customerName", o.total, o.timestamp, o.province,
                lm.carrier, lm.status, lm.is_contra_entrega, lm.contraentrega_collected
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE o."tenantId" = $1
              AND lm.status = 'Entregado'
            ${dateSql}
            ORDER BY o.timestamp ASC
        `, ...params);

        // Fetch correos_shipping_cost separately — column may not exist if migration 006 hasn't run
        try {
            const costRows = await prisma.$queryRawUnsafe<{ crm_order_id: string; correos_shipping_cost: number | null }[]>(`
                SELECT lm.crm_order_id, lm.correos_shipping_cost
                FROM lm_orders lm
                INNER JOIN "Order" o ON o.id = lm.crm_order_id
                WHERE o."tenantId" = $1 AND lm.status = 'Entregado' AND lm.carrier = 'correos'
                ${dateSql}
            `, ...params);
            const costMap: Record<string, number | null> = {};
            for (const r of costRows) costMap[r.crm_order_id] = r.correos_shipping_cost;
            for (const o of orders) {
                o.correos_shipping_cost = costMap[o.id] ?? null;
            }
        } catch {
            // correos_shipping_cost column doesn't exist yet; all orders get null
            for (const o of orders) o.correos_shipping_cost = null;
        }

        // 3. Segment by carrier
        const correoOrders = orders.filter(o => o.carrier === 'correos');
        const mensajeriaOrders = orders.filter(o => o.carrier === 'mensajeria');
        const ceOrders = orders.filter(o => o.is_contra_entrega);
        const ceCollected = ceOrders.filter(o => o.contraentrega_collected);

        // 4. Per-day breakdown for mensajeria (Green Delivery recolecciones)
        const dayMap: Record<string, { date: string; packages: number; total: number; ce: number }> = {};
        for (const o of mensajeriaOrders) {
            const d = new Date(o.timestamp).toISOString().slice(0, 10);
            if (!dayMap[d]) dayMap[d] = { date: d, packages: 0, total: 0, ce: 0 };
            dayMap[d].packages++;
            dayMap[d].total += Number(o.total);
            if (o.is_contra_entrega) dayMap[d].ce += Number(o.total);
        }
        const dailyBreakdown = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

        // 5. Work days in date range
        const workDays = await prisma.$queryRawUnsafe<any[]>(`
            SELECT id, staff_name, work_date, notes
            FROM lm_work_days
            WHERE staff_name = $1
            ${dateFrom ? `AND work_date >= '${dateFrom}'` : ''}
            ${dateTo ? `AND work_date <= '${dateTo}'` : ''}
            ORDER BY work_date ASC
        `, staffName);

        // 6. Cost calculations
        // Correos: use per-order correos_shipping_cost (manually entered in Contabilidad)
        const correosCost = correoOrders.reduce((s, o) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0), 0);
        const correosPendingCost = correoOrders.filter(o => o.correos_shipping_cost == null).length;
        const correosMontoCrmTotal = correoOrders.reduce((s, o) => s + Number(o.total), 0);
        const correosHandling = correoOrders.length * handlingRate;
        const correosMontoTotal = correosCost + correosHandling;

        const mensajeriaCost = gdRecoleccionCost; // flat trip cost
        const mensajeriaHandling = mensajeriaOrders.length * handlingRate;
        const mensajeriaCeAmount = ceOrders.reduce((s, o) => s + Number(o.total), 0);

        const salaryDays = workDays.length;
        const salaryTotal = salaryDays * salaryRate;

        const grandTotal = correosMontoTotal + mensajeriaCost + mensajeriaHandling + salaryTotal;

        return NextResponse.json({
            period: { dateFrom, dateTo },
            tenantId,
            staffName,
            correos: {
                packages: correoOrders.length,
                ratePerPackage: correosRate,
                shippingCost: correosCost,
                pendingCostCount: correosPendingCost,
                handlingRate,
                handlingCost: correosHandling,
                crmTotal: correosMontoCrmTotal,
                montoTotal: correosMontoTotal,
                orders: correoOrders,
            },
            mensajeria: {
                packages: mensajeriaOrders.length,
                recoleccionCost: mensajeriaCost,
                handlingRate,
                handlingCost: mensajeriaHandling,
                dailyBreakdown,
                ceOrders: ceOrders.length,
                ceCollected: ceCollected.length,
                ceAmountTotal: mensajeriaCeAmount,
                orders: mensajeriaOrders,
            },
            salary: {
                staffName,
                daysWorked: salaryDays,
                dailyRate: salaryRate,
                total: salaryTotal,
                workDays,
            },
            totals: {
                totalPackages: orders.length,
                grandTotal,
                shipping: correosCost + mensajeriaCost,
                handling: correosHandling + mensajeriaHandling,
                salary: salaryTotal,
            },
        });
    } catch (error) {
        console.error('[reports GET]', error);
        return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
    }
}
