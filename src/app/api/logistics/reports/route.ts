import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

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

// GET /api/logistics/reports?tenantId=&dateFrom=&dateTo=&staffName=&includeBilled=&billedWeekId=&currentWeek=true
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const staffName = url.searchParams.get('staffName') ?? 'Marlenn';
    const includeBilled = url.searchParams.get('includeBilled') === 'true';
    let billedWeekId = url.searchParams.get('billedWeekId');
    const currentWeek = url.searchParams.get('currentWeek') === 'true';

    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    try {
        let weekMeta: { id: number; week_start: string; week_end: string; finalized_at: string | null } | null = null;

        if (currentWeek && !billedWeekId) {
            const monday = getMondayCR();
            const sunday = getSundayCR(monday);
            const existing = await prisma.$queryRawUnsafe<{ id: number; week_start: string; week_end: string; finalized_at: string | null }[]>(
                `SELECT id, week_start::text, week_end::text, finalized_at::text
                 FROM lm_billing_weeks WHERE week_start = $1::date`, monday
            );
            if (existing.length > 0) {
                weekMeta = existing[0];
                billedWeekId = String(existing[0].id);
            } else {
                const inserted = await prisma.$queryRawUnsafe<{ id: number; week_start: string; week_end: string; finalized_at: string | null }[]>(
                    `INSERT INTO lm_billing_weeks (week_start, week_end)
                     VALUES ($1::date, $2::date)
                     ON CONFLICT (week_start) DO UPDATE SET week_end = EXCLUDED.week_end
                     RETURNING id, week_start::text, week_end::text, finalized_at::text`,
                    monday, sunday
                );
                weekMeta = inserted[0];
                billedWeekId = String(inserted[0].id);
            }
        }

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

        // 2. Build date filters and billing scope
        const dateCol = 'COALESCE(lm.completed_at, o.timestamp)';
        let dateSql = '';
        const params: any[] = [tenantId];

        let billedFilter = '';
        if (billedWeekId) {
            params.push(Number(billedWeekId));
            billedFilter = ` AND lm.billed_week_id = $${params.length}`;
        } else {
            if (!includeBilled) {
                billedFilter = ' AND lm.billed_week_id IS NULL';
            }

            if (dateFrom && dateTo) {
                params.push(dateFrom);
                const pFrom = params.length;
                params.push(dateTo);
                const pTo = params.length;
                dateSql += ` AND ${dateCol} >= ($${pFrom}::date AT TIME ZONE '${CR_TZ}')
                     AND ${dateCol} < (($${pTo}::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')`;
            } else if (dateFrom) {
                params.push(dateFrom);
                dateSql += ` AND ${dateCol} >= ($${params.length}::date AT TIME ZONE '${CR_TZ}')`;
            } else if (dateTo) {
                params.push(dateTo);
                dateSql += ` AND ${dateCol} < (($${params.length}::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')`;
            }
        }

        // 3. Fetch orders — DISTINCT ON prevents duplicates from multiple lm_orders rows
        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT DISTINCT ON (o.id)
                o.id, o."orderId", o."customerName", o.total, o.timestamp,
                o.province, o.product, o."shippingCost",
                lm.carrier, lm.status AS lm_status,
                lm.is_contra_entrega, lm.contraentrega_collected,
                lm.correos_shipping_cost, lm.billed_week_id, lm.completed_at,
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
            completedAt: o.completed_at ?? null,
        }));

        return NextResponse.json({
            period: { dateFrom, dateTo },
            tenantId,
            staffName,
            ...(weekMeta ? { billingWeek: weekMeta } : {}),
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
