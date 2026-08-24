import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
    sqlCostaRicaDayAfter,
    sqlCostaRicaDayStart,
    sqlCostaRicaHalfOpenRange,
} from '@/lib/costa-rica-clock-range';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { calculateTilopayFees, isTilopayOrder, TILOPAY_FEE_RATES } from '@/lib/tilopay-fees';
import { getLogisticsRates } from '@/lib/logistics-rates';
import { isManagedTenantId } from '@/lib/logistics-managed-tenants';

const CR_TZ = 'America/Costa_Rica';
const CORREOS_TAX_RATE = 0.13;

function getCorreosTax(cost: unknown): number {
    if (cost == null) return 0;
    const amount = Number(cost);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount * CORREOS_TAX_RATE);
}

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

function getWorkUnits(notes: unknown): number {
    if (typeof notes !== 'string' || !notes.trim()) return 1;
    try {
        const parsed = JSON.parse(notes);
        const units = Number(parsed?.units);
        if (Number.isFinite(units) && units >= 0 && units <= 1) return units;
        const hours = Number(parsed?.hours);
        if (Number.isFinite(hours) && hours >= 0) return Math.min(hours, 8) / 8;
        return parsed?.dayType === 'half' ? 0.5 : 1;
    } catch {
        return 1;
    }
}

// GET /api/logistics/reports?tenantId=&dateFrom=&dateTo=&staffName=&includeBilled=&billedWeekId=&currentWeek=true
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const url = new URL(req.url);
    const tenantId = url.searchParams.get('tenantId');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    const staffName = url.searchParams.get('staffName') ?? 'Ma';
    const includeBilled = url.searchParams.get('includeBilled') === 'true';
    let billedWeekId = url.searchParams.get('billedWeekId');
    const currentWeek = url.searchParams.get('currentWeek') === 'true';

    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    if (!isManagedTenantId(tenantId)) {
        return NextResponse.json({ error: 'Tenant not in managed allowlist' }, { status: 403 });
    }

    try {
        let weekMeta: { id: number; week_start: string; week_end: string; finalized_at: string | null } | null = null;
        let periodDateFrom = dateFrom;
        let periodDateTo = dateTo;

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

        if (billedWeekId && !weekMeta) {
            const weekRows = await prisma.$queryRawUnsafe<{ id: number; week_start: string; week_end: string; finalized_at: string | null }[]>(
                `SELECT id, week_start::text, week_end::text, finalized_at::text
                 FROM lm_billing_weeks WHERE id = $1`,
                Number(billedWeekId)
            );
            weekMeta = weekRows[0] ?? null;
        }

        if (weekMeta) {
            periodDateFrom = weekMeta.week_start.slice(0, 10);
            periodDateTo = weekMeta.week_end.slice(0, 10);
        }

        // 1. Fetch rates config
        const cfg = await getLogisticsRates([
            'mensajeria_rate',
            'correos_rate',
            'handling_rate',
            'salary_daily_rate',
            'gd_recoleccion_cost',
        ]);

        const mensajeriaRate = cfg.mensajeria_rate;
        const handlingRate = cfg.handling_rate;
        const salaryRate = cfg.salary_daily_rate;

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
                dateSql += ` AND ${sqlCostaRicaHalfOpenRange(dateCol, `$${pFrom}`, `$${pTo}`)}`;
            } else if (dateFrom) {
                params.push(dateFrom);
                dateSql += ` AND ${dateCol} >= ${sqlCostaRicaDayStart(`$${params.length}`)}`;
            } else if (dateTo) {
                params.push(dateTo);
                dateSql += ` AND ${dateCol} < ${sqlCostaRicaDayAfter(`$${params.length}`)}`;
            }
        }

        // 3. Fetch orders — DISTINCT ON prevents duplicates from multiple lm_orders rows
        const orders = await prisma.$queryRawUnsafe<any[]>(`
            SELECT DISTINCT ON (o.id)
                o.id, o."orderId", o."customerName", o.total, o.timestamp,
                ${dateCol} AS report_date,
                o.province, o.product, o."shippingCost", o.comments, o."customFields", o."salesChannel",
                lm.carrier, lm.status AS lm_status,
                lm.is_contra_entrega, lm.contraentrega_collected,
                lm.correos_shipping_cost, lm.billed_week_id, lm.completed_at,
                sg."guiaNumber", sg."trackingNumber"
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            LEFT JOIN LATERAL (
                SELECT sg."guiaNumber", sg."trackingNumber"
                FROM "ShippingGuia" sg
                WHERE sg."tenantId" = o."tenantId"
                  AND sg."orderId" = o."orderId"
                  AND sg.carrier = 'correos_cr'
                ORDER BY sg."updatedAt" DESC, sg."createdAt" DESC
                LIMIT 1
            ) sg ON TRUE
            WHERE o."tenantId" = $1
              AND lm.status = 'Entregado'
              ${billedFilter}
              ${dateSql}
            ORDER BY o.id, o.timestamp ASC
        `, ...params);

        // Re-sort by the same effective date used for filtering after DISTINCT ON removed duplicates.
        orders.sort((a, b) => new Date(a.report_date ?? a.timestamp).getTime() - new Date(b.report_date ?? b.timestamp).getTime());

        // 4. Segment by carrier
        const correoOrders = orders.filter(o => o.carrier === 'correos');
        const mensajeriaOrders = orders.filter(o => o.carrier === 'mensajeria');
        const ceOrders = orders.filter(o => o.is_contra_entrega);
        const ceCollected = ceOrders.filter(o => o.contraentrega_collected);

        // 5. Per-day breakdown for mensajeria using CR timezone
        const dayMap: Record<string, { date: string; packages: number; total: number; ce: number; shippingCost: number }> = {};
        for (const o of mensajeriaOrders) {
            const d = toCRDate(o.report_date ?? o.timestamp);
            if (!dayMap[d]) dayMap[d] = { date: d, packages: 0, total: 0, ce: 0, shippingCost: 0 };
            dayMap[d].packages++;
            dayMap[d].total += Number(o.total);
            dayMap[d].shippingCost += mensajeriaRate;
            if (o.is_contra_entrega) dayMap[d].ce += Number(o.total);
        }
        const dailyBreakdown = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

        // 6. Work days in date range
        let workDaySql = 'SELECT id, staff_name, work_date, notes FROM lm_work_days WHERE staff_name = $1';
        const workDayParams: any[] = [staffName];
        if (periodDateFrom) { workDayParams.push(periodDateFrom); workDaySql += ` AND work_date >= $${workDayParams.length}::date`; }
        if (periodDateTo) { workDayParams.push(periodDateTo); workDaySql += ` AND work_date <= $${workDayParams.length}::date`; }
        workDaySql += ' ORDER BY work_date ASC';
        const workDays = (await prisma.$queryRawUnsafe<any[]>(workDaySql, ...workDayParams)).map((day) => {
            const units = getWorkUnits(day.notes);
            return {
                ...day,
                work_units: units,
                day_type: units === 0.5 ? 'half' : 'full',
            };
        });

        // 7. Cost calculations — flat, unambiguous structure
        const correosShipping = correoOrders.reduce(
            (s, o) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0), 0
        );
        const correosTax = correoOrders.reduce((s, o) => s + getCorreosTax(o.correos_shipping_cost), 0);
        const correosPendingCost = correoOrders.filter(o => o.correos_shipping_cost == null).length;
        const correosHandling = correoOrders.length * handlingRate;

        const mensajeriaShipping = mensajeriaOrders.length * mensajeriaRate;
        const mensajeriaHandling = mensajeriaOrders.length * handlingRate;
        const mensajeriaCeAmount = ceOrders.reduce((s, o) => s + Number(o.total), 0);
        const orderTilopayFees = new Map<string, ReturnType<typeof calculateTilopayFees>>(
            orders.map((o): [string, ReturnType<typeof calculateTilopayFees>] => [o.id, calculateTilopayFees(o.total, isTilopayOrder(o))])
        );
        const tilopayFeeRows = orders.map((o) => orderTilopayFees.get(o.id)!);
        const tilopayOrderCount = tilopayFeeRows.filter((fee) => fee.isTilopay).length;
        const tilopayCommission = tilopayFeeRows.reduce((s, fee) => s + fee.commission, 0);
        const tilopayTransactionCost = tilopayFeeRows.reduce((s, fee) => s + fee.transactionCost, 0);
        const tilopayServiceTax = tilopayFeeRows.reduce((s, fee) => s + fee.serviceTax, 0);
        const tilopayFees = tilopayFeeRows.reduce((s, fee) => s + fee.total, 0);

        const totalShipping = correosShipping + mensajeriaShipping;
        const totalHandling = correosHandling + mensajeriaHandling;
        const subtotalLogistics = totalShipping + totalHandling + correosTax + tilopayFees;

        const salaryDays = workDays.reduce((sum, day) => sum + Number(day.work_units ?? 1), 0);
        const salaryTotal = salaryDays * salaryRate;
        const grandTotal = subtotalLogistics + salaryTotal;

        // 8. Format order data with CR timezone timestamps
        const formatOrders = (list: any[]) => list.map(o => {
            const tilopayFee = orderTilopayFees.get(o.id) ?? calculateTilopayFees(o.total, isTilopayOrder(o));
            return {
                id: o.id,
                orderId: o.orderId,
                customerName: o.customerName,
                total: Number(o.total),
                timestamp: o.timestamp,
                timestampCR: formatCRDateTime(o.timestamp),
                dateCR: toCRDate(o.timestamp),
                reportDate: o.report_date ?? o.timestamp,
                reportTimestampCR: formatCRDateTime(o.report_date ?? o.timestamp),
                reportDateCR: toCRDate(o.report_date ?? o.timestamp),
                province: o.province,
                product: o.product,
                shippingCost: o.shippingCost != null ? Number(o.shippingCost) : null,
                carrier: o.carrier,
                isContraEntrega: o.is_contra_entrega ?? false,
                contraentregaCollected: o.contraentrega_collected ?? false,
                correosShippingCost: o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : null,
                correosTax: getCorreosTax(o.correos_shipping_cost),
                mensajeriaShippingCost: o.carrier === 'mensajeria' ? mensajeriaRate : null,
                handlingCost: handlingRate,
                isTilopay: tilopayFee.isTilopay,
                tilopayCommission: tilopayFee.commission,
                tilopayTransactionCost: tilopayFee.transactionCost,
                tilopayServiceTax: tilopayFee.serviceTax,
                tilopayFee: tilopayFee.total,
                guiaNumber: o.guiaNumber ?? null,
                trackingNumber: o.trackingNumber ?? null,
                billedWeekId: o.billed_week_id,
                completedAt: o.completed_at ?? null,
            };
        });

        return NextResponse.json({
            period: { dateFrom: periodDateFrom, dateTo: periodDateTo },
            tenantId,
            staffName,
            ...(weekMeta ? { billingWeek: weekMeta } : {}),
            correos: {
                packages: correoOrders.length,
                shippingCost: correosShipping,
                pendingCostCount: correosPendingCost,
                taxRate: CORREOS_TAX_RATE,
                taxCost: correosTax,
                handlingRate,
                handlingCost: correosHandling,
                montoTotal: correosShipping + correosTax + correosHandling,
                orders: formatOrders(correoOrders),
            },
            mensajeria: {
                packages: mensajeriaOrders.length,
                shippingRate: mensajeriaRate,
                shippingCost: mensajeriaShipping,
                recoleccionCost: mensajeriaShipping,
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
            tilopay: {
                orders: tilopayOrderCount,
                commissionRate: TILOPAY_FEE_RATES.commissionRate,
                transactionCostRate: TILOPAY_FEE_RATES.transactionCostRate,
                serviceTaxRate: TILOPAY_FEE_RATES.serviceTaxRate,
                commission: tilopayCommission,
                transactionCost: tilopayTransactionCost,
                serviceTax: tilopayServiceTax,
                total: tilopayFees,
            },
            totals: {
                totalPackages: orders.length,
                correosShipping,
                correosTax,
                correosHandling,
                mensajeriaRecoleccion: mensajeriaShipping,
                mensajeriaShipping,
                mensajeriaHandling,
                tilopayFees,
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
