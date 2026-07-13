import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth-options';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getLogisticsRates } from '@/lib/logistics-rates';

const CR_TZ = 'America/Costa_Rica';
const MAX_BATCH = 200;
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

async function ensurePrivateDeliveryTable() {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS lm_private_delivery_confirmations (
            id BIGSERIAL PRIMARY KEY,
            crm_order_id TEXT NOT NULL UNIQUE,
            crm_tenant_id TEXT NOT NULL,
            cost_amount NUMERIC(12,2) NOT NULL DEFAULT 2800,
            delivery_confirmed_at TIMESTAMPTZ,
            paid_confirmed_at TIMESTAMPTZ,
            archived_at TIMESTAMPTZ,
            notes TEXT,
            actor TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_private_delivery_confirmations_tenant_idx
        ON lm_private_delivery_confirmations (crm_tenant_id)
    `);
    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS lm_private_delivery_confirmations_archived_idx
        ON lm_private_delivery_confirmations (archived_at)
    `);
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
                lm.status AS lm_status,
                lm.completed_at,
                lm.billed_week_id,
                COALESCE(lm.completed_at, o.timestamp) AS report_date,
                pdc.cost_amount,
                pdc.delivery_confirmed_at,
                pdc.paid_confirmed_at,
                pdc.archived_at,
                pdc.notes,
                pdc.actor,
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

        const orders = rows.map((row) => {
            const costAmount = parseMoney(row.cost_amount, defaultCost);
            const deliveryConfirmedAt = row.delivery_confirmed_at ?? null;
            const paidConfirmedAt = row.paid_confirmed_at ?? null;
            const archivedAt = row.archived_at ?? null;
            const confirmed = Boolean(deliveryConfirmedAt && paidConfirmedAt);

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
                confirmationUpdatedAt: row.confirmation_updated_at ?? null,
                privateStatus: archivedAt ? 'Archivado' : confirmed ? 'Confirmado' : 'Pendiente',
            };
        });

        const totalCost = orders.reduce((sum, order) => sum + order.costAmount, 0);
        const delivered = orders.filter((order) => order.lmStatus === 'Entregado').length;
        const paid = orders.filter((order) => order.paidConfirmedAt).length;

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
            },
        });
    } catch (error) {
        console.error('[private-delivery GET]', error);
        return NextResponse.json({ error: 'Failed to fetch private delivery orders' }, { status: 500 });
    }
}

// POST /api/logistics/private-delivery
// Body: { orderIds: string[], costAmount?: number, costByOrder?: Record<string, number>, notes?: string }
export async function POST(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        await ensurePrivateDeliveryTable();

        const body = await req.json() as {
            orderIds?: unknown[];
            costAmount?: unknown;
            costByOrder?: Record<string, unknown>;
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

        const rates = await getLogisticsRates(['mensajeria_rate']);
        const defaultCost = parseMoney(body.costAmount, rates.mensajeria_rate);
        const actor = await getActor();
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
                const costAmount = parseMoney(body.costByOrder?.[orderId], defaultCost);
                await tx.$executeRaw`
                    INSERT INTO lm_private_delivery_confirmations (
                        crm_order_id,
                        crm_tenant_id,
                        cost_amount,
                        delivery_confirmed_at,
                        paid_confirmed_at,
                        archived_at,
                        notes,
                        actor
                    )
                    VALUES (
                        ${orderId},
                        ${row.tenant_id},
                        ${costAmount},
                        NOW(),
                        NOW(),
                        NOW(),
                        ${notes || null},
                        ${actor}
                    )
                    ON CONFLICT (crm_order_id) DO UPDATE SET
                        cost_amount = EXCLUDED.cost_amount,
                        delivery_confirmed_at = COALESCE(lm_private_delivery_confirmations.delivery_confirmed_at, NOW()),
                        paid_confirmed_at = COALESCE(lm_private_delivery_confirmations.paid_confirmed_at, NOW()),
                        archived_at = COALESCE(lm_private_delivery_confirmations.archived_at, NOW()),
                        notes = COALESCE(EXCLUDED.notes, lm_private_delivery_confirmations.notes),
                        actor = EXCLUDED.actor,
                        updated_at = NOW()
                `;
            }
        });

        try {
            const payloadJson = JSON.stringify({ count: orderIds.length, source: 'private_delivery_dashboard' });
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

        return NextResponse.json({ success: true, confirmed: orderIds.length });
    } catch (error: any) {
        if (error instanceof SyntaxError) {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        console.error('[private-delivery POST]', error);
        return NextResponse.json({ error: 'Failed to confirm private delivery orders' }, { status: 500 });
    }
}

// PATCH /api/logistics/private-delivery
// Body: { orderId: string, costAmount?: number, notes?: string, archived?: boolean }
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
        const costAmount = parseMoney(body.costAmount, rates.mensajeria_rate);
        const notes = typeof body.notes === 'string' ? body.notes.trim() : null;
        const actor = await getActor();
        const archived = body.archived;

        await prisma.$executeRaw`
            INSERT INTO lm_private_delivery_confirmations (
                crm_order_id,
                crm_tenant_id,
                cost_amount,
                notes,
                actor
            )
            VALUES (${orderId}, ${row.tenant_id}, ${costAmount}, ${notes}, ${actor})
            ON CONFLICT (crm_order_id) DO UPDATE SET
                cost_amount = EXCLUDED.cost_amount,
                notes = COALESCE(EXCLUDED.notes, lm_private_delivery_confirmations.notes),
                actor = EXCLUDED.actor,
                updated_at = NOW()
        `;

        if (archived === true) {
            await prisma.$executeRaw`
                UPDATE lm_private_delivery_confirmations
                SET delivery_confirmed_at = COALESCE(delivery_confirmed_at, NOW()),
                    paid_confirmed_at = COALESCE(paid_confirmed_at, NOW()),
                    archived_at = COALESCE(archived_at, NOW()),
                    actor = ${actor},
                    updated_at = NOW()
                WHERE crm_order_id = ${orderId}
            `;
        } else if (archived === false) {
            await prisma.$executeRaw`
                UPDATE lm_private_delivery_confirmations
                SET archived_at = NULL,
                    actor = ${actor},
                    updated_at = NOW()
                WHERE crm_order_id = ${orderId}
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
