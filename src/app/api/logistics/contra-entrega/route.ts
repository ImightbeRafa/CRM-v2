import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

const PAYMENT_METHODS = new Set(['sinpe', 'efectivo']);

async function ensureCePaymentMethodColumn() {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE lm_ce_payments
        ADD COLUMN IF NOT EXISTS payment_method TEXT
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE lm_ce_payments
        ADD COLUMN IF NOT EXISTS confirmed_by_employee_id TEXT
    `);
}

function normalizePaymentMethod(value: unknown): 'sinpe' | 'efectivo' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return PAYMENT_METHODS.has(normalized) ? (normalized as 'sinpe' | 'efectivo') : null;
}

async function resolveActiveEmployee(employeeId: unknown) {
    if (typeof employeeId !== 'string' || !employeeId.trim()) return null;
    const id = employeeId.trim();
    // lm_employees.id is uuid — Prisma binds JS strings as text unless cast.
    try {
        const rows = await prisma.$queryRaw<{ id: string; display_name: string }[]>`
            SELECT id, display_name
            FROM lm_employees
            WHERE id = ${id}::uuid AND active = TRUE
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) return null;
        return { id: row.id, displayName: row.display_name };
    } catch {
        return null;
    }
}

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
        await ensureCePaymentMethodColumn();

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
                (COALESCE(o."contraEntrega", FALSE) OR COALESCE(lm.is_contra_entrega, FALSE)) AS "isContraEntrega",
                (COALESCE(o."cePaymentConfirmed", FALSE) OR COALESCE(lm.contraentrega_collected, FALSE)) AS "collected"
            FROM "Order" o
            LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE (lm.is_contra_entrega = TRUE OR o."contraEntrega" = TRUE)
            ${dateSql}${ceSql}${tenantSql}
            ORDER BY o.timestamp DESC
            LIMIT 500
        `, ...params);

        // Fetch any confirmed payment records for these orders
        const orderIds = rows.map((r) => r.orderId);
        let payments: any[] = [];
        if (orderIds.length > 0) {
            payments = await prisma.$queryRaw<any[]>`
                SELECT crm_order_id, amount, collected_at, notes, confirmed_by, payment_method
                FROM lm_ce_payments
                WHERE crm_order_id = ANY(${orderIds}::text[])
                ORDER BY collected_at DESC
            `;
        }

        const paymentMap: Record<string, any[]> = {};
        for (const p of payments) {
            if (!paymentMap[p.crm_order_id]) paymentMap[p.crm_order_id] = [];
            paymentMap[p.crm_order_id].push({
                ...p,
                paymentMethod: p.payment_method ?? null,
                confirmedBy: p.confirmed_by ?? null,
            });
        }

        const enriched = rows.map((r) => {
            const orderPayments = paymentMap[r.orderId] || [];
            const latest = orderPayments[0] || null;
            return {
                ...r,
                payments: orderPayments,
                paymentMethod: latest?.paymentMethod ?? null,
                confirmedBy: latest?.confirmedBy ?? null,
            };
        });

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

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { orderId, amount, notes } = body;
    const paymentMethod = normalizePaymentMethod(body.paymentMethod ?? body.payment_method);
    const employeeId = body.confirmedByEmployeeId ?? body.employeeId;

    if (!orderId || typeof orderId !== 'string') {
        return NextResponse.json({ error: 'orderId required' }, { status: 400 });
    }
    if (!paymentMethod) {
        return NextResponse.json({ error: 'paymentMethod must be sinpe or efectivo' }, { status: 400 });
    }

    try {
        await ensureCePaymentMethodColumn();

        const employee = await resolveActiveEmployee(employeeId);
        if (!employee) {
            return NextResponse.json({ error: 'confirmedByEmployeeId must be an active employee from Personal' }, { status: 400 });
        }

        // Derive tenantId from persisted data, not from the request body.
        const [orderRow, crmOrder] = await Promise.all([
            prisma.$queryRaw<any[]>`
                SELECT crm_tenant_id, contraentrega_collected FROM lm_orders WHERE crm_order_id = ${orderId} LIMIT 1
            `,
            prisma.order.findUnique({
                where: { id: orderId },
                select: { tenantId: true, total: true, cePaymentConfirmed: true, contraEntrega: true },
            }),
        ]);
        const derivedTenantId = orderRow?.[0]?.crm_tenant_id ?? crmOrder?.tenantId;
        if (!derivedTenantId) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const alreadyCollected = Boolean(orderRow?.[0]?.contraentrega_collected || crmOrder?.cePaymentConfirmed);
        if (alreadyCollected) {
            return NextResponse.json({
                success: true,
                alreadyCollected: true,
                paymentMethod,
                confirmedBy: employee.displayName,
                confirmedByEmployeeId: employee.id,
            });
        }

        const resolvedAmount = Number.isFinite(Number(amount)) && Number(amount) >= 0
            ? Number(amount)
            : Number(crmOrder?.total ?? 0);

        await prisma.$executeRaw`
            INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, is_contra_entrega)
            VALUES (${orderId}, ${derivedTenantId}, 'retiro', 'Pendiente', TRUE)
            ON CONFLICT (crm_order_id) DO UPDATE
            SET is_contra_entrega = TRUE,
                carrier = COALESCE(lm_orders.carrier, EXCLUDED.carrier),
                updated_at = NOW()
        `;

        await prisma.$executeRaw`
            UPDATE lm_orders SET contraentrega_collected = TRUE, updated_at = NOW()
            WHERE crm_order_id = ${orderId}
        `;

        await prisma.$executeRaw`
            INSERT INTO lm_ce_payments (crm_order_id, crm_tenant_id, amount, notes, confirmed_by, payment_method, confirmed_by_employee_id)
            VALUES (${orderId}, ${derivedTenantId}, ${resolvedAmount}, ${notes ?? null}, ${employee.displayName}, ${paymentMethod}, ${employee.id})
        `;

        // Log event
        await prisma.$executeRaw`
            INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor)
            VALUES (
                ${orderId},
                'ce_confirmed',
                ${JSON.stringify({
                    amount: resolvedAmount,
                    notes,
                    paymentMethod,
                    confirmedByEmployeeId: employee.id,
                    confirmedBy: employee.displayName,
                    sessionActor: actor,
                })}::jsonb,
                ${employee.displayName}
            )
        `;

        // Sync to core Order model
        try {
            await prisma.order.update({
                where: { id: orderId },
                data: { contraEntrega: true, cePaymentConfirmed: true },
            });
        } catch (syncErr) {
            console.error('[contra-entrega POST] Order model sync failed (non-fatal):', syncErr);
        }

        return NextResponse.json({
            success: true,
            paymentMethod,
            confirmedBy: employee.displayName,
            confirmedByEmployeeId: employee.id,
            amount: resolvedAmount,
        });
    } catch (error) {
        console.error('[contra-entrega POST]', error);
        return NextResponse.json({ error: 'Failed to confirm CE payment' }, { status: 500 });
    }
}
