import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import {
    mapLogisticsStatusToCrmStatus,
    shouldAutoSyncLogisticsStatus,
} from '@/lib/logistics-crm-sync';
import {
    isManagedTenantId,
    resolveManagedTenantFilter,
    managedTenantIdsForSql,
} from '@/lib/logistics-managed-tenants';
import { fetchArchivedLogisticsOrders, type ArchivedLogisticsOrder } from '@/lib/logistics-archived-orders';

type GuiaInfo = {
    guiaId: string;
    guiaNumber: string | null;
    trackingNumber: string | null;
    guiaStatus: string | null;
    guiaError: string | null;
    hasGuiaPdf: boolean;
};

async function enrichArchivedOrders(orders: ArchivedLogisticsOrder[]) {
    if (orders.length === 0) return [];

    const orderIds = orders.map((o) => o.id);
    const ceById: Record<string, { method: string | null; confirmedBy: string | null }> = {};
    const guiaByKey: Record<string, GuiaInfo> = {};

    await Promise.all([
        (async () => {
            try {
                const ceRows = await prisma.$queryRaw<{ crm_order_id: string; payment_method: string | null; confirmed_by: string | null }[]>`
                    SELECT DISTINCT ON (crm_order_id)
                        crm_order_id, payment_method, confirmed_by
                    FROM lm_ce_payments
                    WHERE crm_order_id = ANY(${orderIds}::text[])
                    ORDER BY crm_order_id, collected_at DESC NULLS LAST
                `;
                for (const row of ceRows) {
                    ceById[row.crm_order_id] = {
                        method: row.payment_method ?? null,
                        confirmedBy: row.confirmed_by ?? null,
                    };
                }
            } catch {
                // CE payment enrichment is optional
            }
        })(),
        (async () => {
            try {
                const guiaRows = await prisma.shippingGuia.findMany({
                    where: {
                        tenantId: { in: [...new Set(orders.map((o) => o.tenantId))] },
                        orderId: { in: orders.map((o) => o.orderId) },
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
                    if (guiaByKey[key]) continue;
                    guiaByKey[key] = {
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
        })(),
    ]);

    return orders.map((o) => {
        const guia = guiaByKey[`${o.tenantId}:${o.orderId}`];
        const ce = ceById[o.id];
        return {
            ...o,
            cePaymentMethod: ce?.method ?? null,
            ceConfirmedBy: ce?.confirmedBy ?? null,
            guiaId: guia?.guiaId ?? null,
            guiaNumber: guia?.guiaNumber ?? null,
            trackingNumber: guia?.trackingNumber ?? null,
            guiaStatus: guia?.guiaStatus ?? null,
            guiaError: guia?.guiaError ?? null,
            hasGuiaPdf: guia?.hasGuiaPdf ?? false,
        };
    });
}

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
        const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const requestedLimit = parseInt(url.searchParams.get('limit') || '100', 10);
        const limit = Math.min(800, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100));
        const skip = (page - 1) * limit;

        // Default: only show orders from Feb 22 2026 onwards (cutoff date when LM went live)
        const DEFAULT_CUTOFF = new Date('2026-02-22T00:00:00.000Z');

        const tenantFilter = resolveManagedTenantFilter(tenantId);
        if (!tenantFilter.ok) {
            return NextResponse.json({ error: 'Tenant not in managed allowlist' }, { status: 403 });
        }

        const tenantIds = managedTenantIdsForSql(tenantFilter.tenantId);

        if (archivedFilter === 'true') {
            const archived = await fetchArchivedLogisticsOrders({
                tenantIds,
                search,
                dateFrom,
                dateTo,
                status,
                courier,
                lmCarrier: lmCarrierFilter,
                page,
                limit,
            });
            const enriched = await enrichArchivedOrders(archived.orders);
            return NextResponse.json({
                orders: enriched,
                pagination: {
                    total: archived.total,
                    page,
                    limit,
                    pages: Math.ceil(archived.total / limit) || 0,
                },
            });
        }

        const where: any = {
            tenantId: tenantFilter.tenantId,
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
        // Scoped to managed tenants so we never scan the full lm_orders table.
        if (lmCarrierFilter) {
            try {
                const lmFilterRows = await prisma.$queryRaw<{ crm_order_id: string }[]>`
                    SELECT crm_order_id FROM lm_orders
                    WHERE carrier = ${lmCarrierFilter}
                    AND crm_tenant_id = ANY(${tenantIds}::text[])
                `;
                where.id = { in: lmFilterRows.map((r) => r.crm_order_id) };
            } catch {
                // lm_orders table may not exist; fall back to post-query filtering
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

        type LmRow = {
            lmCarrier: string | null;
            lmStatus: string | null;
            isContraEntrega: boolean;
            contraEntregaCollected: boolean;
            archivedAt: string | null;
            correosShippingCost: number | null;
            cePaymentMethod?: string | null;
            ceConfirmedBy?: string | null;
        };
        const orderIds = orders.map((o) => o.id);
        const lmData: Record<string, LmRow> = {};
        const guiaData: Record<string, { guiaId: string; guiaNumber: string | null; trackingNumber: string | null; guiaStatus: string | null; guiaError: string | null; hasGuiaPdf: boolean }> = {};
        if (orderIds.length > 0) {
            const loadLm = async () => {
                try {
                    const lmRows = await prisma.$queryRaw<{
                        crm_order_id: string;
                        carrier: string | null;
                        status: string | null;
                        is_contra_entrega: boolean;
                        contraentrega_collected: boolean;
                        archived_at: string | null;
                        correos_shipping_cost: number | null;
                    }[]>`
                        SELECT crm_order_id, carrier, status, is_contra_entrega, contraentrega_collected, archived_at, correos_shipping_cost
                        FROM lm_orders
                        WHERE crm_order_id = ANY(${orderIds}::text[])
                    `;
                    for (const row of lmRows) {
                        lmData[row.crm_order_id] = {
                            lmCarrier: row.carrier,
                            lmStatus: row.status,
                            isContraEntrega: row.is_contra_entrega ?? false,
                            contraEntregaCollected: row.contraentrega_collected ?? false,
                            archivedAt: row.archived_at ?? null,
                            correosShippingCost: row.correos_shipping_cost != null ? Number(row.correos_shipping_cost) : null,
                        };
                    }
                } catch {
                    try {
                        const lmRows = await prisma.$queryRaw<{
                            crm_order_id: string;
                            carrier: string | null;
                            status: string | null;
                            is_contra_entrega: boolean;
                            contraentrega_collected: boolean;
                            archived_at: string | null;
                        }[]>`
                            SELECT crm_order_id, carrier, status, is_contra_entrega, contraentrega_collected, archived_at
                            FROM lm_orders
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
                        // lm_orders table may not be accessible
                    }
                }
            };

            const loadCe = async () => {
                try {
                    const ceRows = await prisma.$queryRaw<{ crm_order_id: string; payment_method: string | null; confirmed_by: string | null }[]>`
                        SELECT DISTINCT ON (crm_order_id)
                            crm_order_id, payment_method, confirmed_by
                        FROM lm_ce_payments
                        WHERE crm_order_id = ANY(${orderIds}::text[])
                        ORDER BY crm_order_id, collected_at DESC NULLS LAST
                    `;
                    for (const row of ceRows) {
                        if (lmData[row.crm_order_id]) {
                            lmData[row.crm_order_id].cePaymentMethod = row.payment_method ?? null;
                            lmData[row.crm_order_id].ceConfirmedBy = row.confirmed_by ?? null;
                        } else {
                            lmData[row.crm_order_id] = {
                                lmCarrier: null,
                                lmStatus: null,
                                isContraEntrega: false,
                                contraEntregaCollected: false,
                                archivedAt: null,
                                correosShippingCost: null,
                                cePaymentMethod: row.payment_method ?? null,
                                ceConfirmedBy: row.confirmed_by ?? null,
                            };
                        }
                    }
                } catch {
                    // CE payment enrichment is optional
                }
            };

            const loadGuias = async () => {
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
            };

            await loadLm();
            await Promise.all([loadCe(), loadGuias()]);
        }

        const enriched = orders.map((o) => ({
            ...o,
            lmCarrier: lmData[o.id]?.lmCarrier ?? null,
            isContraEntrega: (o as any).contraEntrega || lmData[o.id]?.isContraEntrega || false,
            contraEntregaCollected: (o as any).cePaymentConfirmed || lmData[o.id]?.contraEntregaCollected || false,
            cePaymentMethod: (lmData[o.id] as any)?.cePaymentMethod ?? null,
            ceConfirmedBy: (lmData[o.id] as any)?.ceConfirmedBy ?? null,
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
        if (archivedFilter !== 'all') {
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

        if (!isManagedTenantId(crmOrder.tenantId)) {
            return NextResponse.json({ error: 'Order tenant not in managed allowlist' }, { status: 403 });
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
