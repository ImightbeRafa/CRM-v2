import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

const CR_TZ = 'America/Costa_Rica';

// GET /api/logistics/reports?tenantId=&dateFrom=&dateTo=&staffName=&includeBilled=&billedWeekId=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const staffName = url.searchParams.get('staffName') ?? 'Marlenn';
    const includeBilled = url.searchParams.get('includeBilled') === 'true';
    const billedWeekId = url.searchParams.get('billedWeekId');

    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    try {
        // 1. Fetch rates config
        const rateRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
            SELECT key, value FROM lm_carrier_configs
            WHERE key IN ('mensajeria_rate','correos_rate','handling_rate','salary_daily_rate','gd_recoleccion_cost')
        `;
        const cfg: Record<string, number> = {};
        for (const r of rateRows) cfg[r.key] = Number(r.value) || 0;

        const handlingRate = cfg['handling_rate'] ?? 600;
        const salaryRate = cfg['salary_daily_rate'] ?? 10000;
        const gdRecoleccionCost = cfg['gd_recoleccion_cost'] ?? 2700;

        // 2. Build date filters with proper CR timezone handling
        let dateSql = '';
        const params: any[] = [tenantId];

        if (dateFrom) {
            params.push(dateFrom);
            dateSql += ` AND o.timestamp >= ($${params.length}::date AT TIME ZONE '${CR_TZ}')`;
        }
        if (dateTo) {
            params.push(dateTo);
            dateSql += ` AND o.timestamp < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')`;
        }

        let billedFilter = '';
        if (billedWeekId) {
            params.push(Number(billedWeekId));
            billedFilter = ` AND lm.billed_week_id = $${params.length}`;
        } else if (!includeBilled) {
            billedFilter = ' AND lm.billed_week_id IS NULL';
        }

        // 3. Fetch orders — DISTINCT ON prevents duplicates from multiple lm_orders rows
        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT DISTINCT ON (o.id)
                o.id, o."orderId", o."customerName", o.total, o.timestamp,
                o.province, o.product, o."shippingCost",
                lm.carrier, lm.status AS lm_status,
                lm.is_contra_entrega, lm.contraentrega_collected,
                lm.correos_shipping_cost, lm.billed_week_id,
                sg."guiaNumber", sg."trackingNumber"
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            LEFT JOIN "ShippingGuia" sg ON sg."orderId" = o.id
            WHERE o."tenantId" = $1
              AND lm.status = 'Entregado'
              ${billedFilter}
              ${dateSql}
            ORDER BY o.id, o.timestamp ASC
        `, ...params);

        // Re-sort by timestamp after DISTINCT ON removed duplicates
        orders.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        // 4. Segment by carrier
        const correoOrders = orders.filter(o => o.carrier === 'correos');
        const mensajeriaOrders = orders.filter(o => o.carrier === 'mensajeria');
        const ceOrders = orders.filter(o => o.is_contra_entrega);
        const ceCollected = ceOrders.filter(o => o.contraentrega_collected);

        // 5. Per-day breakdown for mensajeria using CR timezone
        const dayMap: Record<string, { date: string; packages: number; total: number; ce: number }> = {};
        for (const o of mensajeriaOrders) {
            const d = toCRDate(o.timestamp);
            if (!dayMap[d]) dayMap[d] = { date: d, packages: 0, total: 0, ce: 0 };
            dayMap[d].packages++;
            dayMap[d].total += Number(o.total);
            if (o.is_contra_entrega) dayMap[d].ce += Number(o.total);
        }
        const dailyBreakdown = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

        // 6. Work days in date range
        let workDaySql = 'SELECT id, staff_name, work_date, notes FROM lm_work_days WHERE staff_name = $1';
        const workDayParams: any[] = [staffName];
        if (dateFrom) { workDayParams.push(dateFrom); workDaySql += ` AND work_date >= $${workDayParams.length}::date`; }
        if (dateTo) { workDayParams.push(dateTo); workDaySql += ` AND work_date <= $${workDayParams.length}::date`; }
        workDaySql += ' ORDER BY work_date ASC';
        const workDays = await prisma.$queryRawUnsafe<any[]>(workDaySql, ...workDayParams);

        // 7. Cost calculations — flat, unambiguous structure
        const correosShipping = correoOrders.reduce(
            (s, o) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0), 0
        );
        const correosPendingCost = correoOrders.filter(o => o.correos_shipping_cost == null).length;
        const correosHandling = correoOrders.length * handlingRate;

        const mensajeriaRecoleccion = mensajeriaOrders.length > 0 ? gdRecoleccionCost : 0;
        const mensajeriaHandling = mensajeriaOrders.length * handlingRate;
        const mensajeriaCeAmount = ceOrders.reduce((s, o) => s + Number(o.total), 0);

        const totalShipping = correosShipping + mensajeriaRecoleccion;
        const totalHandling = correosHandling + mensajeriaHandling;
        const subtotalLogistics = totalShipping + totalHandling;

        const salaryDays = workDays.length;
        const salaryTotal = salaryDays * salaryRate;
        const grandTotal = subtotalLogistics + salaryTotal;

        // 8. Format order data with CR timezone timestamps
        const formatOrders = (list: any[]) => list.map(o => ({
            id: o.id,
            orderId: o.orderId,
            customerName: o.customerName,
            total: Number(o.total),
            timestamp: o.timestamp,
            timestampCR: formatCRDateTime(o.timestamp),
            dateCR: toCRDate(o.timestamp),
            province: o.province,
            product: o.product,
            shippingCost: o.shippingCost != null ? Number(o.shippingCost) : null,
            carrier: o.carrier,
            isContraEntrega: o.is_contra_entrega ?? false,
            contraentregaCollected: o.contraentrega_collected ?? false,
            correosShippingCost: o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : null,
            handlingCost: handlingRate,
            guiaNumber: o.guiaNumber ?? null,
            trackingNumber: o.trackingNumber ?? null,
            billedWeekId: o.billed_week_id,
        }));

        return NextResponse.json({
            period: { dateFrom, dateTo },
            tenantId,
            staffName,
            correos: {
                packages: correoOrders.length,
                shippingCost: correosShipping,
                pendingCostCount: correosPendingCost,
                handlingRate,
                handlingCost: correosHandling,
                montoTotal: correosShipping + correosHandling,
                orders: formatOrders(correoOrders),
            },
            mensajeria: {
                packages: mensajeriaOrders.length,
                recoleccionCost: mensajeriaRecoleccion,
                handlingRate,
                handlingCost: mensajeriaHandling,
                dailyBreakdown,
                ceOrders: ceOrders.length,
                ceCollected: ceCollected.length,
                ceAmountTotal: mensajeriaCeAmount,
                orders: formatOrders(mensajeriaOrders),
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
                correosShipping,
                correosHandling,
                mensajeriaRecoleccion,
                mensajeriaHandling,
                totalShipping,
                totalHandling,
                subtotalLogistics,
                salary: salaryTotal,
                grandTotal,
            },
        });
    } catch (error) {
        console.error('[reports GET]', error);
        return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
    }
}

function toCRDate(timestamp: string | Date): string {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-CA', { timeZone: CR_TZ });
}

function formatCRDateTime(timestamp: string | Date): string {
    const d = new Date(timestamp);
    return d.toLocaleString('es-CR', {
        timeZone: CR_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}
