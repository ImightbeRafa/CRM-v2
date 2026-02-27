import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

const MANAGED_TENANT_IDS = [
    'cmh32z0ol0000k004hvx9tg3p',
    'cmhsibjue0004js04gie724nx',
    'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e',
    'cmjdabz4d0000il04dyc5qmcc',
    'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0',
];

// GET /api/logistics/orders
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get('tenantId');
        const status = url.searchParams.get('status');
        const courier = url.searchParams.get('courier');
        const lmCarrierFilter = url.searchParams.get('lmCarrier');
        const archivedFilter = url.searchParams.get('archived'); // 'true' | 'all' | null (default: exclude archived)
        const search = url.searchParams.get('search');
        const dateFrom = url.searchParams.get('dateFrom');
        const dateTo = url.searchParams.get('dateTo');
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const limit = parseInt(url.searchParams.get('limit') || '200', 10);
        const skip = (page - 1) * limit;

        // Default: only show orders from Feb 22 2026 onwards (cutoff date when LM went live)
        const DEFAULT_CUTOFF = new Date('2026-02-22T00:00:00.000Z');

        const where: any = {
            tenantId: tenantId ? tenantId : { in: MANAGED_TENANT_IDS },
            timestamp: {
                gte: dateFrom ? new Date(dateFrom) : DEFAULT_CUTOFF,
                ...(dateTo ? { lte: new Date(dateTo + 'T23:59:59.999Z') } : {}),
            },
        };

        if (status) where.status = status;
        if (courier) where.courier = courier;
        if (search) {
            where.OR = [
                { customerName: { contains: search, mode: 'insensitive' } },
                { orderId: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search } },
                { address: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where,
                select: {
                    id: true,
                    orderId: true,
                    tenantId: true,
                    status: true,
                    timestamp: true,
                    customerName: true,
                    phone: true,
                    email: true,
                    product: true,
                    quantity: true,
                    size: true,
                    color: true,
                    total: true,
                    shippingCost: true,
                    address: true,
                    province: true,
                    canton: true,
                    district: true,
                    courier: true,
                    delivery: true,
                    expectedDate: true,
                    orderType: true,
                    agreedDate: true,
                    pickupDate: true,
                    comments: true,
                    seller: true,
                    customFields: true,
                    tenant: { select: { name: true, slug: true, businessName: true } },
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: limit,
            }),
            prisma.order.count({ where }),
        ]);

        // Enrich with lm_orders data (logistics carrier + logistics status)
        const orderIds = orders.map((o) => o.id);
        const lmData: Record<string, { lmCarrier: string | null; lmStatus: string | null; isContraEntrega: boolean; contraEntregaCollected: boolean; archivedAt: string | null }> = {};
        if (orderIds.length > 0) {
            try {
                const lmRows = await prisma.$queryRaw<{ crm_order_id: string; carrier: string | null; status: string | null; is_contra_entrega: boolean; contraentrega_collected: boolean; archived_at: string | null }[]>`
                    SELECT crm_order_id, carrier, status, is_contra_entrega, contraentrega_collected, archived_at FROM lm_orders
                    WHERE crm_order_id = ANY(${orderIds}::text[])
                `;
                for (const row of lmRows) {
                    lmData[row.crm_order_id] = {
                        lmCarrier: row.carrier,
                        lmStatus: row.status,
                        isContraEntrega: row.is_contra_entrega ?? false,
                        contraEntregaCollected: row.contraentrega_collected ?? false,
                        archivedAt: row.archived_at ?? null,
                    };
                }
            } catch {
                // lm_orders table may not be accessible; continue without lm data
            }
        }

        const enriched = orders.map((o) => ({
            ...o,
            lmCarrier: lmData[o.id]?.lmCarrier ?? null,
            isContraEntrega: lmData[o.id]?.isContraEntrega ?? false,
            contraEntregaCollected: lmData[o.id]?.contraEntregaCollected ?? false,
            lmStatus: lmData[o.id]?.lmStatus ?? null,
            archivedAt: lmData[o.id]?.archivedAt ?? null,
        }));

        // Filter by carrier
        let filtered = lmCarrierFilter
            ? enriched.filter((o) => o.lmCarrier === lmCarrierFilter)
            : enriched;

        // Filter by archive status
        if (archivedFilter === 'true') {
            filtered = filtered.filter((o) => o.archivedAt !== null);
        } else if (archivedFilter !== 'all') {
            // Default: exclude archived orders from the active board
            filtered = filtered.filter((o) => o.archivedAt === null);
        }

        return NextResponse.json({
            orders: filtered,
            pagination: { total, page, limit, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('[logistics/orders GET]', error);
        return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
    }
}

// PATCH /api/logistics/orders — persist any combination of logistics fields
export async function PATCH(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    const body = await req.json();
    const { orderId, lmCarrier, lmStatus, isContraEntrega, contraEntregaCollected, archivedAt } = body;

    if (!orderId) return NextResponse.json({ error: 'orderId required' }, { status: 400 });

    try {
        const existing = await prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM lm_orders WHERE crm_order_id = ${orderId} LIMIT 1
        `;

        if (existing.length > 0) {
            // Build dynamic SET clauses
            const sets: string[] = ['updated_at=NOW()'];
            const params: any[] = [];
            if (lmCarrier !== undefined) { params.push(lmCarrier); sets.unshift(`carrier=$${params.length}`); }
            if (lmStatus !== undefined) { params.push(lmStatus); sets.unshift(`status=$${params.length}`); }
            if (isContraEntrega !== undefined) { params.push(isContraEntrega); sets.unshift(`is_contra_entrega=$${params.length}`); }
            if (contraEntregaCollected !== undefined) { params.push(contraEntregaCollected); sets.unshift(`contraentrega_collected=$${params.length}`); }
            if (archivedAt !== undefined) { params.push(archivedAt); sets.unshift(`archived_at=$${params.length}`); }
            params.push(orderId);
            const sql = `UPDATE lm_orders SET ${sets.join(',')} WHERE crm_order_id=$${params.length}`;
            await prisma.$executeRawUnsafe(sql, ...params);
        } else {
            // Look up crm_tenant_id — required NOT NULL on lm_orders
            const crmOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { tenantId: true } });
            const crm_tenant_id = crmOrder?.tenantId ?? '';
            const c = lmCarrier ?? null;
            const s = lmStatus ?? 'Pendiente';
            const ce = isContraEntrega ?? false;
            const cc = contraEntregaCollected ?? false;
            await prisma.$executeRaw`INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, is_contra_entrega, contraentrega_collected) VALUES (${orderId},${crm_tenant_id},${c},${s},${ce},${cc})`;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[logistics/orders PATCH]', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}
