import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { MANAGED_TENANT_IDS } from '@/lib/logistics-managed-tenants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/guias/history
 *
 * Returns one current guia per managed order. The visible status is the
 * logistics/order status, not the internal guia persistence status.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const { searchParams } = new URL(req.url);
        const requestedLimit = parseInt(searchParams.get('limit') || '50', 10);
        const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 500);
        const carrier = searchParams.get('carrier') || null;
        const archived = searchParams.get('archived');
        const search = (searchParams.get('search') || '').trim();
        const statusFilter = (searchParams.get('status') || searchParams.get('estado') || '').trim();

        const baseParams: any[] = [MANAGED_TENANT_IDS];
        const guiaWhere: string[] = ['sg."tenantId" = ANY($1::text[])'];
        const baseOuterWhere: string[] = [];

        if (carrier) {
            baseParams.push(carrier);
            guiaWhere.push(`sg.carrier = $${baseParams.length}`);
        }

        if (archived === 'true') {
            baseOuterWhere.push('lm.archived_at IS NOT NULL');
        } else if (archived === 'false') {
            baseOuterWhere.push('lm.archived_at IS NULL');
        }

        if (search) {
            baseParams.push(`%${search}%`);
            baseOuterWhere.push(`(
                o."orderId" ILIKE $${baseParams.length}
                OR o."customerName" ILIKE $${baseParams.length}
                OR o.phone ILIKE $${baseParams.length}
                OR o.address ILIKE $${baseParams.length}
                OR cg."guiaNumber" ILIKE $${baseParams.length}
                OR cg."trackingNumber" ILIKE $${baseParams.length}
                OR t.name ILIKE $${baseParams.length}
                OR t."businessName" ILIKE $${baseParams.length}
            )`);
        }

        const params = [...baseParams];
        const outerWhere = [...baseOuterWhere];
        if (statusFilter) {
            params.push(statusFilter);
            outerWhere.push(`LOWER(COALESCE(lm.status, o.status, cg.guia_status)) = LOWER($${params.length})`);
        }

        params.push(limit);
        const limitParam = params.length;

        const guias = await prisma.$queryRawUnsafe<any[]>(`
            WITH current_guias AS (
                SELECT DISTINCT ON (sg."tenantId", sg."orderId", sg.carrier)
                    sg.id,
                    sg."tenantId",
                    sg."orderId",
                    sg.carrier,
                    sg."guiaNumber",
                    sg."trackingNumber",
                    sg.status AS guia_status,
                    sg.progress,
                    sg."errorMessage",
                    sg."pdfFileName",
                    (sg."pdfData" IS NOT NULL) AS has_pdf,
                    sg."createdAt",
                    sg."updatedAt"
                FROM "ShippingGuia" sg
                WHERE ${guiaWhere.join(' AND ')}
                ORDER BY sg."tenantId", sg."orderId", sg.carrier, sg."updatedAt" DESC, sg."createdAt" DESC
            )
            SELECT
                cg.*,
                COUNT(*) OVER() AS total_count,
                t.name AS tenant_name,
                t."businessName" AS tenant_business_name,
                o.id AS crm_order_id,
                o."customerName",
                o.phone,
                o.address,
                o.province,
                o.canton,
                o.district,
                o.total,
                o.status AS crm_status,
                lm.status AS lm_status,
                lm.carrier AS lm_carrier,
                lm.archived_at
            FROM current_guias cg
            LEFT JOIN "Tenant" t ON t.id = cg."tenantId"
            LEFT JOIN "Order" o ON o."tenantId" = cg."tenantId" AND o."orderId" = cg."orderId"
            LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
            ${outerWhere.length > 0 ? `WHERE ${outerWhere.join(' AND ')}` : ''}
            ORDER BY cg."updatedAt" DESC, cg."createdAt" DESC
            LIMIT $${limitParam}
        `, ...params);

        const statuses = await prisma.$queryRawUnsafe<any[]>(`
            WITH current_guias AS (
                SELECT DISTINCT ON (sg."tenantId", sg."orderId", sg.carrier)
                    sg.id,
                    sg."tenantId",
                    sg."orderId",
                    sg.carrier,
                    sg.status AS guia_status,
                    sg."createdAt",
                    sg."updatedAt"
                FROM "ShippingGuia" sg
                WHERE ${guiaWhere.join(' AND ')}
                ORDER BY sg."tenantId", sg."orderId", sg.carrier, sg."updatedAt" DESC, sg."createdAt" DESC
            )
            SELECT
                COALESCE(lm.status, o.status, cg.guia_status) AS status,
                COUNT(*)::int AS count
            FROM current_guias cg
            LEFT JOIN "Tenant" t ON t.id = cg."tenantId"
            LEFT JOIN "Order" o ON o."tenantId" = cg."tenantId" AND o."orderId" = cg."orderId"
            LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
            ${baseOuterWhere.length > 0 ? `WHERE ${baseOuterWhere.join(' AND ')}` : ''}
            GROUP BY COALESCE(lm.status, o.status, cg.guia_status)
            ORDER BY count DESC, status ASC
        `, ...baseParams);

        return NextResponse.json({
            total: guias.length > 0 ? Number(guias[0].total_count) : 0,
            limit,
            statuses: statuses
                .filter(s => s.status)
                .map(s => ({ status: s.status, count: Number(s.count) })),
            guias: guias.map(g => {
                const orderStatus = g.lm_status || g.crm_status || g.guia_status;
                return {
                    id: g.id,
                    tenantId: g.tenantId,
                    orderId: g.orderId,
                    carrier: g.carrier,
                    guiaNumber: g.guiaNumber,
                    trackingNumber: g.trackingNumber,
                    status: orderStatus,
                    orderStatus,
                    crmStatus: g.crm_status || null,
                    lmStatus: g.lm_status || null,
                    guiaStatus: g.guia_status,
                    progress: g.progress,
                    errorMessage: g.errorMessage,
                    pdfFileName: g.pdfFileName,
                    createdAt: g.createdAt,
                    updatedAt: g.updatedAt,
                    hasPdf: !!g.has_pdf,
                    tenantName: g.tenant_business_name || g.tenant_name || g.tenantId,
                    customerName: g.customerName || '',
                    phone: g.phone || '',
                    address: g.address || '',
                    province: g.province || '',
                    canton: g.canton || '',
                    district: g.district || '',
                    total: g.total != null ? Number(g.total) : null,
                    lmCarrier: g.lm_carrier || null,
                    archivedAt: g.archived_at || null,
                };
            }),
        });
    } catch (error) {
        console.error('[logistics/guias/history GET]', error);
        return NextResponse.json({ error: 'Failed to fetch guia history' }, { status: 500 });
    }
}
