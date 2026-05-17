import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
    mapLogisticsStatusToCrmStatus,
    shouldAutoSyncLogisticsStatus,
} from '@/lib/logistics-crm-sync';

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

        // Pre-filter by lm_orders at DB level to avoid pagination holes.
        // When a carrier or archive filter is specified, we first resolve matching
        // order IDs from lm_orders so the main Prisma query only returns relevant rows.
        if (lmCarrierFilter) {
            try {
                const lmFilterRows = await prisma.$queryRaw<{ crm_order_id: string }[]>`
                    SELECT crm_order_id FROM lm_orders WHERE carrier = ${lmCarrierFilter}
                `;
                where.id = { in: lmFilterRows.map((r) => r.crm_order_id) };
            } catch {
                // lm_orders table may not exist; fall back to post-query filtering
            }
        } else if (archivedFilter === 'true') {
            try {
                const archivedRows = await prisma.$queryRaw<{ crm_order_id: string }[]>`
                    SELECT crm_order_id FROM lm_orders WHERE archived_at IS NOT NULL
                `;
                where.id = { in: archivedRows.map((r) => r.crm_order_id) };
            } catch {
                // fall back to post-query filtering
            }
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
                    contraEntrega: true,
                    cePaymentConfirmed: true,
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
        const lmData: Record<string, { lmCarrier: string | null; lmStatus: string | null; isContraEntrega: boolean; contraEntregaCollected: boolean; archivedAt: string | null; correosShippingCost: number | null }> = {};
        const guiaData: Record<string, { guiaId: string; guiaNumber: string | null; trackingNumber: string | null; guiaStatus: string | null; guiaError: string | null; hasGuiaPdf: boolean }> = {};
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
                        correosShippingCost: null,
                    };
                }
            } catch {
                // lm_orders table may not be accessible; continue without lm data
            }

            // Fetch correos_shipping_cost separately — column may not exist if migration 006 hasn't run
            try {
                const costRows = await prisma.$queryRaw<{ crm_order_id: string; correos_shipping_cost: number | null }[]>`
                    SELECT crm_order_id, correos_shipping_cost FROM lm_orders
                    WHERE crm_order_id = ANY(${orderIds}::text[]) AND correos_shipping_cost IS NOT NULL
                `;
                for (const row of costRows) {
                    if (lmData[row.crm_order_id]) {
                        lmData[row.crm_order_id].correosShippingCost = row.correos_shipping_cost != null ? Number(row.correos_shipping_cost) : null;
                    }
                }
            } catch {
                // correos_shipping_cost column may not exist yet; ignore
            }

            try {
                const guiaRows = await prisma.shippingGuia.findMany({
                    where: {
                        tenantId: { in: [...new Set(orders.map(o => o.tenantId))] },
                        orderId: { in: orders.map(o => o.orderId) },
                        carrier: 'correos_cr',
                    },
                    orderBy: [
                        { updatedAt: 'desc' },
                        { createdAt: 'desc' },
                    ],
                    select: {
                        id: true,
                        tenantId: true,
                        orderId: true,
                        guiaNumber: true,
                        trackingNumber: true,
                        status: true,
                        errorMessage: true,
                        pdfFileName: true,
                    },
                });

                for (const row of guiaRows) {
                    const key = `${row.tenantId}:${row.orderId}`;
                    if (guiaData[key]) continue;
                    guiaData[key] = {
                        guiaId: row.id,
                        guiaNumber: row.guiaNumber ?? null,
                        trackingNumber: row.trackingNumber ?? null,
                        guiaStatus: row.status ?? null,
                        guiaError: row.errorMessage ?? null,
                        hasGuiaPdf: !!row.pdfFileName,
                    };
                }
            } catch {
                // Continue without guia enrichment if the table is unavailable.
            }
        }

        const enriched = orders.map((o) => ({
            ...o,
            lmCarrier: lmData[o.id]?.lmCarrier ?? null,
            isContraEntrega: (o as any).contraEntrega || lmData[o.id]?.isContraEntrega || false,
            contraEntregaCollected: (o as any).cePaymentConfirmed || lmData[o.id]?.contraEntregaCollected || false,
            lmStatus: lmData[o.id]?.lmStatus ?? null,
            archivedAt: lmData[o.id]?.archivedAt ?? null,
            correosShippingCost: lmData[o.id]?.correosShippingCost ?? null,
            guiaId: guiaData[`${o.tenantId}:${o.orderId}`]?.guiaId ?? null,
            guiaNumber: guiaData[`${o.tenantId}:${o.orderId}`]?.guiaNumber ?? null,
            trackingNumber: guiaData[`${o.tenantId}:${o.orderId}`]?.trackingNumber ?? null,
            guiaStatus: guiaData[`${o.tenantId}:${o.orderId}`]?.guiaStatus ?? null,
            guiaError: guiaData[`${o.tenantId}:${o.orderId}`]?.guiaError ?? null,
            hasGuiaPdf: guiaData[`${o.tenantId}:${o.orderId}`]?.hasGuiaPdf ?? false,
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
        const [existing, crmOrder] = await Promise.all([
            prisma.$queryRaw<{ id: string; is_contra_entrega: boolean; contraentrega_collected: boolean }[]>`
                SELECT id, is_contra_entrega, contraentrega_collected FROM lm_orders WHERE crm_order_id = ${orderId} LIMIT 1
            `,
            prisma.order.findUnique({
                where: { id: orderId },
                select: { tenantId: true, contraEntrega: true, cePaymentConfirmed: true },
            }),
        ]);

        if (!crmOrder) {
            return NextResponse.json({ error: 'Order not found' }, { status: 404 });
        }

        const existingLm = existing[0];
        const effectiveContraEntrega = isContraEntrega !== undefined
            ? Boolean(isContraEntrega)
            : Boolean(crmOrder.contraEntrega || existingLm?.is_contra_entrega);
        const effectiveCollected = contraEntregaCollected !== undefined
            ? Boolean(contraEntregaCollected)
            : Boolean(crmOrder.cePaymentConfirmed || existingLm?.contraentrega_collected);

        if (lmStatus === 'Entregado' && effectiveContraEntrega && !effectiveCollected) {
            return NextResponse.json(
                { error: 'Payment must be confirmed before marking contra entrega as Entregado' },
                { status: 400 },
            );
        }

        const actor = req.headers.get('x-user-email') ?? 'system';

        if (existing.length > 0) {
            // Build dynamic SET clauses
            const sets: string[] = ['updated_at=NOW()'];
            const params: any[] = [];
            if (lmCarrier !== undefined) { params.push(lmCarrier); sets.unshift(`carrier=$${params.length}`); }
            if (lmStatus !== undefined) { params.push(lmStatus); sets.unshift(`status=$${params.length}`); }
            if (isContraEntrega !== undefined) { params.push(isContraEntrega); sets.unshift(`is_contra_entrega=$${params.length}`); }
            if (contraEntregaCollected !== undefined) { params.push(contraEntregaCollected); sets.unshift(`contraentrega_collected=$${params.length}`); }
            if (archivedAt !== undefined) {
                params.push(archivedAt ? new Date(archivedAt) : null);
                sets.unshift(`archived_at=$${params.length}`);
                if (!archivedAt) {
                    // Restoring: also clear billing fields so the order can be re-terminated
                    sets.push('billed_week_id=NULL', 'billed_at=NULL');
                }
            }

            if (lmStatus !== undefined) {
                if (lmStatus === 'Entregado') {
                    sets.push('completed_at=NOW()');
                    params.push(actor); sets.push(`completed_by=$${params.length}`);
                } else {
                    sets.push('completed_at=NULL');
                    sets.push('completed_by=NULL');
                }
            }

            params.push(orderId);
            const sql = `UPDATE lm_orders SET ${sets.join(',')} WHERE crm_order_id=$${params.length}`;
            await prisma.$executeRawUnsafe(sql, ...params);
        } else {
            // Look up crm_tenant_id — required NOT NULL on lm_orders
            const crm_tenant_id = crmOrder?.tenantId ?? '';
            const c = lmCarrier ?? null;
            const s = lmStatus ?? 'Pendiente';
            const ce = isContraEntrega ?? false;
            const cc = contraEntregaCollected ?? false;
            const archVal = archivedAt ? new Date(archivedAt) : null;
            const completedAt = s === 'Entregado' ? new Date() : null;
            const completedBy = s === 'Entregado' ? actor : null;
            await prisma.$executeRaw`INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status, is_contra_entrega, contraentrega_collected, archived_at, completed_at, completed_by) VALUES (${orderId},${crm_tenant_id},${c},${s},${ce},${cc},${archVal},${completedAt},${completedBy})`;
        }

        // Sync logistics completion and CE fields back to the tenant-visible Order model.
        const orderUpdate: any = {};
        if (isContraEntrega !== undefined) orderUpdate.contraEntrega = isContraEntrega;
        if (contraEntregaCollected !== undefined) orderUpdate.cePaymentConfirmed = contraEntregaCollected;
        if (shouldAutoSyncLogisticsStatus(lmStatus)) {
            orderUpdate.status = mapLogisticsStatusToCrmStatus(lmStatus);
        }
        if (Object.keys(orderUpdate).length > 0) {
            try {
                await prisma.order.update({
                    where: { id: orderId },
                    data: orderUpdate,
                });
            } catch (syncErr) {
                console.error('[logistics/orders PATCH] Order model sync failed:', syncErr);
                if ('status' in orderUpdate) {
                    throw syncErr;
                }
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('[logistics/orders PATCH]', error);
        return NextResponse.json({ error: 'Failed to update order' }, { status: 500 });
    }
}
