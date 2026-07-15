import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth-options';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getLogisticsRates } from '@/lib/logistics-rates';

const CR_TZ = 'America/Costa_Rica';
const MAX_BATCH = 200;
const SETTLEMENT_METHODS = new Set(['sinpe', 'efectivo']);
const MANAGED_TENANT_IDS = [
    'cmh32z0ol0000k004hvx9tg3p',
    'cmhsibjue0004js04gie724nx',
    'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e',
    'cmjdabz4d0000il04dyc5qmcc',
    'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0',
    'cmm4pv8fl0000jr045en1nik9',
];

async function ensureCePaymentMethodColumn() {
    try {
        await prisma.$executeRawUnsafe(`
            ALTER TABLE lm_ce_payments
            ADD COLUMN IF NOT EXISTS payment_method TEXT
        `);
    } catch {
        // lm_ce_payments may not exist in some environments
    }
}

async function ensurePrivateDeliveryTable() {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_private_delivery_confirmations (
            id BIGSERIAL PRIMARY KEY,
            crm_order_id TEXT NOT NULL UNIQUE,
            crm_tenant_id TEXT NOT NULL,
            cost_amount NUMERIC(12,2) NOT NULL DEFAULT 2500,
            delivery_confirmed_at TIMESTAMPTZ,
            paid_confirmed_at TIMESTAMPTZ,
            archived_at TIMESTAMPTZ,
            notes TEXT,
            actor TEXT,
            settlement_method TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE lm_private_delivery_confirmations
        ADD COLUMN IF NOT EXISTS settlement_method TEXT
    `);
    await prisma.$executeRawUnsafe(`
        ALTER TABLE lm_private_delivery_confirmations
        ALTER COLUMN cost_amount SET DEFAULT 2500
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_private_delivery_confirmations_tenant_idx
        ON lm_private_delivery_confirmations (crm_tenant_id)
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_private_delivery_confirmations_archived_idx
        ON lm_private_delivery_confirmations (archived_at)
    `);
    // Migrate stale default rate 2800 → 2500 once (does not override other custom values)
    try {
        await prisma.$executeRawUnsafe(`
            UPDATE lm_carrier_configs
            SET value = '2500', updated_at = NOW()
            WHERE key IN ('mensajeria_rate', 'gd_recoleccion_cost')
              AND value IN ('2800', '2800.0', '2800.00')
        `);
    } catch {
        // configs table may not exist yet
    }
}

function toCRDate(timestamp: string | Date): string {
    return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: CR_TZ });
}

function formatCRDateTime(timestamp: string | Date): string {
    return new Date(timestamp).toLocaleString('es-CR', {
        timeZone: CR_TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

function currentMonthRangeCR() {
    const today = toCRDate(new Date());
    return {
        dateFrom: `${today.slice(0, 7)}-01`,
        dateTo: today,
    };
}

function parseMoney(value: unknown, fallback: number) {
    const amount = Number(value);
    return Number.isFinite(amount) && amount >= 0 ? amount : fallback;
}

function normalizeSettlementMethod(value: unknown): 'sinpe' | 'efectivo' | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return SETTLEMENT_METHODS.has(normalized) ? (normalized as 'sinpe' | 'efectivo') : null;
}

async function resolveActiveEmployee(employeeId: unknown) {
    if (typeof employeeId !== 'string' || !employeeId.trim()) return null;
    try {
        const rows = await prisma.$queryRaw<{ id: string; display_name: string }[]>`
            SELECT id, display_name
            FROM lm_employees
            WHERE id = ${employeeId.trim()} AND active = TRUE
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) return null;
        return { id: row.id, displayName: row.display_name };
    } catch {
        return null;
    }
}

async function getActor() {
    const session = await getServerSession(authOptions);
    return session?.user?.email ?? 'system';
}

// GET /api/logistics/private-delivery?dateFrom=&dateTo=&tenantId=&archived=false&search=
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        await ensurePrivateDeliveryTable();
        await ensureCePaymentMethodColumn();

        const url = new URL(req.url);
        const currentRange = currentMonthRangeCR();
        const dateFrom = url.searchParams.get('dateFrom') || currentRange.dateFrom;
        const dateTo = url.searchParams.get('dateTo') || currentRange.dateTo;
        const archived = url.searchParams.get('archived') === 'true';
        const search = url.searchParams.get('search')?.trim();
        const requestedTenantIds = url.searchParams.getAll('tenantId').filter(Boolean);
        const tenantIds = requestedTenantIds.length > 0 ? requestedTenantIds : MANAGED_TENANT_IDS;
        const rates = await getLogisticsRates(['mensajeria_rate']);
        const defaultCost = rates.mensajeria_rate;

        const params: any[] = [tenantIds, dateFrom, dateTo];
        let searchSql = '';
        if (search) {
            params.push(`%${search}%`);
            const idx = params.length;
            searchSql = `
                AND (
                    o."orderId" ILIKE $${idx}
                    OR o."customerName" ILIKE $${idx}
                    OR COALESCE(o.phone, '') ILIKE $${idx}
                    OR COALESCE(o.product, '') ILIKE $${idx}
                    OR COALESCE(o.province, '') ILIKE $${idx}
                    OR COALESCE(o.canton, '') ILIKE $${idx}
                )
            `;
        }

        const rows = await prisma.$queryRawUnsafe<any[]>(`
            SELECT DISTINCT ON (o.id)
                o.id,
                o."orderId",
                o."tenantId",
                o.status AS crm_status,
                o.timestamp,
                o."customerName",
                o.phone,
                o.product,
                o.total,
                o.province,
                o.canton,
                o.district,
                o.address,
                o.comments,
                COALESCE(o."contraEntrega", FALSE) AS crm_contra_entrega,
                COALESCE(o."cePaymentConfirmed", FALSE) AS crm_ce_confirmed,
                lm.status AS lm_status,
                lm.completed_at,
                lm.billed_week_id,
                COALESCE(lm.is_contra_entrega, FALSE) AS lm_is_contra_entrega,
                COALESCE(lm.contraentrega_collected, FALSE) AS lm_ce_collected,
                COALESCE(lm.completed_at, o.timestamp) AS report_date,
                pdc.cost_amount,
                pdc.delivery_confirmed_at,
                pdc.paid_confirmed_at,
                pdc.archived_at,
                pdc.notes,
                pdc.actor,
                pdc.settlement_method,
                pdc.updated_at AS confirmation_updated_at
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            LEFT JOIN lm_private_delivery_confirmations pdc ON pdc.crm_order_id = o.id
            WHERE o."tenantId" = ANY($1::text[])
              AND lm.carrier = 'mensajeria'
              AND COALESCE(lm.completed_at, o.timestamp) >= ($2::date AT TIME ZONE '${CR_TZ}')
              AND COALESCE(lm.completed_at, o.timestamp) < (($3::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')
              AND ${archived ? 'pdc.archived_at IS NOT NULL' : 'pdc.archived_at IS NULL'}
              ${searchSql}
            ORDER BY o.id, COALESCE(lm.completed_at, o.timestamp) ASC
        `, ...params);

        rows.sort((a, b) => new Date(a.report_date ?? a.timestamp).getTime() - new Date(b.report_date ?? b.timestamp).getTime());

        const ceMeta: Record<string, { paymentMethod: string | null; confirmedBy: string | null }> = {};
        try {
            const ids = rows.map((row) => row.id);
            if (ids.length > 0) {
                const ceRows = await prisma.$queryRaw<{ crm_order_id: string; payment_method: string | null; confirmed_by: string | null }[]>`
                    SELECT DISTINCT ON (crm_order_id)
                        crm_order_id, payment_method, confirmed_by
                    FROM lm_ce_payments
                    WHERE crm_order_id = ANY(${ids}::text[])
                    ORDER BY crm_order_id, collected_at DESC NULLS LAST
                `;
                for (const row of ceRows) {
                    ceMeta[row.crm_order_id] = {
                        paymentMethod: row.payment_method ?? null,
                        confirmedBy: row.confirmed_by ?? null,
                    };
                }
            }
        } catch {
            // CE enrichment optional
        }

        const orders = rows.map((row) => {
            const archivedAt = row.archived_at ?? null;
            // Pending rows always display live tariff; archived keep historical stored amount
            const costAmount = archivedAt
                ? parseMoney(row.cost_amount, defaultCost)
                : defaultCost;
            const deliveryConfirmedAt = row.delivery_confirmed_at ?? null;
            const paidConfirmedAt = row.paid_confirmed_at ?? null;
            const confirmed = Boolean(deliveryConfirmedAt && paidConfirmedAt);
            const isContraEntrega = Boolean(row.crm_contra_entrega || row.lm_is_contra_entrega);
            const contraEntregaCollected = Boolean(row.crm_ce_confirmed || row.lm_ce_collected);
            const ce = ceMeta[row.id];

            return {
                id: row.id,
                orderId: row.orderId,
                tenantId: row.tenantId,
                crmStatus: row.crm_status,
                timestamp: row.timestamp,
                timestampCR: formatCRDateTime(row.timestamp),
                reportDate: row.report_date ?? row.timestamp,
                reportDateCR: toCRDate(row.report_date ?? row.timestamp),
                reportTimestampCR: formatCRDateTime(row.report_date ?? row.timestamp),
                customerName: row.customerName,
                phone: row.phone,
                product: row.product,
                total: Number(row.total) || 0,
                province: row.province,
                canton: row.canton,
                district: row.district,
                address: row.address,
                comments: row.comments,
                lmStatus: row.lm_status,
                completedAt: row.completed_at ?? null,
                billedWeekId: row.billed_week_id ?? null,
                costAmount,
                deliveryConfirmedAt,
                paidConfirmedAt,
                archivedAt,
                notes: row.notes ?? '',
                actor: row.actor ?? null,
                settlementMethod: row.settlement_method ?? null,
                confirmationUpdatedAt: row.confirmation_updated_at ?? null,
                isContraEntrega,
                contraEntregaCollected,
                cePaymentMethod: ce?.paymentMethod ?? null,
                ceConfirmedBy: ce?.confirmedBy ?? null,
                privateStatus: archivedAt ? 'Archivado' : confirmed ? 'Confirmado' : 'Pendiente',
            };
        });

        const totalCost = orders.reduce((sum, order) => sum + order.costAmount, 0);
        const delivered = orders.filter((order) => order.lmStatus === 'Entregado').length;
        const paid = orders.filter((order) => order.paidConfirmedAt).length;

        // Period-wide GD ledger stats (sent / confirmed / amount owed), independent of tab filter
        let periodSent = orders.length;
        let periodConfirmed = archived ? orders.length : 0;
        let periodOwed = archived ? 0 : totalCost;
        let periodSettledCost = archived ? totalCost : 0;
        try {
            const periodRows = await prisma.$queryRawUnsafe<{ sent: number; confirmed: number }[]>(`
                SELECT
                    COUNT(*)::int AS sent,
                    COUNT(*) FILTER (WHERE pdc.archived_at IS NOT NULL)::int AS confirmed
                FROM "Order" o
                INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
                LEFT JOIN lm_private_delivery_confirmations pdc ON pdc.crm_order_id = o.id
                WHERE o."tenantId" = ANY($1::text[])
                  AND lm.carrier = 'mensajeria'
                  AND COALESCE(lm.completed_at, o.timestamp) >= ($2::date AT TIME ZONE '${CR_TZ}')
                  AND COALESCE(lm.completed_at, o.timestamp) < (($3::date + INTERVAL '1 day') AT TIME ZONE '${CR_TZ}')
                  ${searchSql}
            `, ...params);
            periodSent = Number(periodRows[0]?.sent) || 0;
            periodConfirmed = Number(periodRows[0]?.confirmed) || 0;
            const periodPending = Math.max(0, periodSent - periodConfirmed);
            periodOwed = periodPending * defaultCost;
            periodSettledCost = periodConfirmed * defaultCost;
        } catch (periodError) {
            console.warn('[private-delivery GET] period summary fallback:', periodError);
        }

        return NextResponse.json({
            period: { dateFrom, dateTo },
            archived,
            defaultCost,
            orders,
            summary: {
                orders: orders.length,
                delivered,
                paid,
                totalCost,
                periodSent,
                periodConfirmed,
                periodPending: Math.max(0, periodSent - periodConfirmed),
                periodOwed,
                periodSettledCost,
            },
        });
    } catch (error) {
        console.error('[private-delivery GET]', error);
        return NextResponse.json({ error: 'Failed to fetch private delivery orders' }, { status: 500 });
    }
}

// POST /api/logistics/private-delivery
// Body: { orderIds: string[], settlementMethod: 'sinpe'|'efectivo', notes?: string }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        await ensurePrivateDeliveryTable();

        const body = await req.json() as {
            orderIds?: unknown[];
            settlementMethod?: unknown;
            confirmedByEmployeeId?: unknown;
            employeeId?: unknown;
            notes?: unknown;
        };
        const orderIds: string[] = Array.isArray(body.orderIds)
            ? [...new Set(body.orderIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0).map((id: string) => id.trim()))]
            : [];

        if (orderIds.length === 0) {
            return NextResponse.json({ error: 'orderIds required' }, { status: 400 });
        }
        if (orderIds.length > MAX_BATCH) {
            return NextResponse.json({ error: `Maximum ${MAX_BATCH} orders per request` }, { status: 400 });
        }

        const settlementMethod = normalizeSettlementMethod(body.settlementMethod);
        if (!settlementMethod) {
            return NextResponse.json({ error: 'settlementMethod must be sinpe or efectivo' }, { status: 400 });
        }

        const employee = await resolveActiveEmployee(body.confirmedByEmployeeId ?? body.employeeId);
        if (!employee) {
            return NextResponse.json({ error: 'confirmedByEmployeeId must be an active employee from Personal' }, { status: 400 });
        }

        const rates = await getLogisticsRates(['mensajeria_rate']);
        const costAmount = rates.mensajeria_rate;
        const sessionActor = await getActor();
        const actor = employee.displayName;
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

        const rows = await prisma.$queryRawUnsafe<{ id: string; tenant_id: string; carrier: string | null; order_ref: string }[]>(`
            SELECT o.id, o."tenantId" AS tenant_id, lm.carrier, o."orderId" AS order_ref
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE o.id = ANY($1::text[])
        `, orderIds);

        const rowById = new Map(rows.map((row) => [row.id, row]));
        const invalid = orderIds.filter((id) => rowById.get(id)?.carrier !== 'mensajeria');
        if (invalid.length > 0) {
            return NextResponse.json({
                error: 'Only Mensajeria Privada orders can be confirmed here',
                invalid,
            }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            for (const orderId of orderIds) {
                const row = rowById.get(orderId)!;
                await tx.$executeRaw`
                    INSERT INTO lm_private_delivery_confirmations (
                        crm_order_id,
                        crm_tenant_id,
                        cost_amount,
                        delivery_confirmed_at,
                        paid_confirmed_at,
                        archived_at,
                        notes,
                        actor,
                        settlement_method
                    )
                    VALUES (
                        ${orderId},
                        ${row.tenant_id},
                        ${costAmount},
                        NOW(),
                        NOW(),
                        NOW(),
                        ${notes || null},
                        ${actor},
                        ${settlementMethod}
                    )
                    ON CONFLICT (crm_order_id) DO UPDATE SET
                        cost_amount = EXCLUDED.cost_amount,
                        delivery_confirmed_at = COALESCE(lm_private_delivery_confirmations.delivery_confirmed_at, NOW()),
                        paid_confirmed_at = COALESCE(lm_private_delivery_confirmations.paid_confirmed_at, NOW()),
                        archived_at = COALESCE(lm_private_delivery_confirmations.archived_at, NOW()),
                        notes = COALESCE(EXCLUDED.notes, lm_private_delivery_confirmations.notes),
                        actor = EXCLUDED.actor,
                        settlement_method = EXCLUDED.settlement_method,
                        updated_at = NOW()
                `;
            }
        });

        try {
            const payloadJson = JSON.stringify({
                count: orderIds.length,
                source: 'private_delivery_dashboard',
                costAmount,
                settlementMethod,
                confirmedByEmployeeId: employee.id,
                confirmedBy: employee.displayName,
                sessionActor,
            });
            const eventValues = orderIds.map((_: string, i: number) => {
                const base = i * 3;
                return `($${base + 1}, 'private_delivery_confirmed', $${base + 2}::jsonb, $${base + 3})`;
            }).join(', ');
            const eventParams = orderIds.flatMap((orderId: string) => [orderId, payloadJson, actor]);
            await prisma.$executeRawUnsafe(
                `INSERT INTO lm_order_events (crm_order_id, event_type, payload, actor) VALUES ${eventValues}`,
                ...eventParams,
            );
        } catch (eventError) {
            console.warn('[private-delivery POST] event log skipped:', eventError);
        }

        return NextResponse.json({
            success: true,
            confirmed: orderIds.length,
            costAmount,
            settlementMethod,
            actor,
            confirmedByEmployeeId: employee.id,
        });
    } catch (error: any) {
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        console.error('[private-delivery POST]', error);
        return NextResponse.json({ error: 'Failed to confirm private delivery orders' }, { status: 500 });
    }
}

// PATCH /api/logistics/private-delivery
// Body: { orderId: string, notes?: string, archived?: boolean }
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        await ensurePrivateDeliveryTable();

        const body = await req.json();
        const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
        if (!orderId) {
            return NextResponse.json({ error: 'orderId required' }, { status: 400 });
        }

        const rows = await prisma.$queryRawUnsafe<{ id: string; tenant_id: string; carrier: string | null }[]>(`
            SELECT o.id, o."tenantId" AS tenant_id, lm.carrier
            FROM "Order" o
            INNER JOIN lm_orders lm ON lm.crm_order_id = o.id
            WHERE o.id = $1
            LIMIT 1
        `, orderId);

        const row = rows[0];
        if (!row || row.carrier !== 'mensajeria') {
            return NextResponse.json({ error: 'Order is not a Mensajeria Privada order' }, { status: 400 });
        }

        const rates = await getLogisticsRates(['mensajeria_rate']);
        const costAmount = rates.mensajeria_rate;
        const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
        const sessionActor = await getActor();
        const archived = body.archived;

        if (archived === true) {
            const settlementMethod = normalizeSettlementMethod(body.settlementMethod);
            if (!settlementMethod) {
                return NextResponse.json({ error: 'settlementMethod must be sinpe or efectivo' }, { status: 400 });
            }
            const employee = await resolveActiveEmployee(body.confirmedByEmployeeId ?? body.employeeId);
            if (!employee) {
                return NextResponse.json({ error: 'confirmedByEmployeeId must be an active employee from Personal' }, { status: 400 });
            }
            await prisma.$executeRaw`
                INSERT INTO lm_private_delivery_confirmations (
                    crm_order_id,
                    crm_tenant_id,
                    cost_amount,
                    notes,
                    actor,
                    settlement_method,
                    delivery_confirmed_at,
                    paid_confirmed_at,
                    archived_at
                )
                VALUES (
                    ${orderId},
                    ${row.tenant_id},
                    ${costAmount},
                    ${notes},
                    ${employee.displayName},
                    ${settlementMethod},
                    NOW(),
                    NOW(),
                    NOW()
                )
                ON CONFLICT (crm_order_id) DO UPDATE SET
                    cost_amount = ${costAmount},
                    notes = COALESCE(${notes}, lm_private_delivery_confirmations.notes),
                    delivery_confirmed_at = COALESCE(lm_private_delivery_confirmations.delivery_confirmed_at, NOW()),
                    paid_confirmed_at = COALESCE(lm_private_delivery_confirmations.paid_confirmed_at, NOW()),
                    archived_at = COALESCE(lm_private_delivery_confirmations.archived_at, NOW()),
                    settlement_method = ${settlementMethod},
                    actor = ${employee.displayName},
                    updated_at = NOW()
            `;
        } else if (archived === false) {
            await prisma.$executeRaw`
                UPDATE lm_private_delivery_confirmations
                SET archived_at = NULL,
                    actor = ${sessionActor},
                    updated_at = NOW()
                WHERE crm_order_id = ${orderId}
            `;
        } else if (notes != null) {
            await prisma.$executeRaw`
                INSERT INTO lm_private_delivery_confirmations (
                    crm_order_id,
                    crm_tenant_id,
                    cost_amount,
                    notes,
                    actor
                )
                VALUES (${orderId}, ${row.tenant_id}, ${costAmount}, ${notes}, ${sessionActor})
                ON CONFLICT (crm_order_id) DO UPDATE SET
                    notes = COALESCE(EXCLUDED.notes, lm_private_delivery_confirmations.notes),
                    actor = EXCLUDED.actor,
                    updated_at = NOW()
            `;
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        console.error('[private-delivery PATCH]', error);
        return NextResponse.json({ error: 'Failed to update private delivery confirmation' }, { status: 500 });
    }
}
