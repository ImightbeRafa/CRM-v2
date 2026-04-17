import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
        const carrier = searchParams.get('carrier') || null;

        const params: any[] = [MANAGED_TENANT_IDS, limit];
        let carrierSql = '';
        if (carrier) {
            params.push(carrier);
            carrierSql = `AND sg.carrier = $${params.length}`;
        }

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
                WHERE sg."tenantId" = ANY($1::text[])
                  ${carrierSql}
                ORDER BY sg."tenantId", sg."orderId", sg.carrier, sg."updatedAt" DESC, sg."createdAt" DESC
            )
            SELECT
                cg.*,
                t.name AS tenant_name,
                o.id AS crm_order_id,
                o."customerName",
                o.status AS crm_status,
                lm.status AS lm_status
            FROM current_guias cg
            LEFT JOIN "Tenant" t ON t.id = cg."tenantId"
            LEFT JOIN "Order" o ON o."tenantId" = cg."tenantId" AND o."orderId" = cg."orderId"
            LEFT JOIN lm_orders lm ON lm.crm_order_id = o.id
            ORDER BY cg."updatedAt" DESC, cg."createdAt" DESC
            LIMIT $2
        `, ...params);

        return NextResponse.json({
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
                    guiaStatus: g.guia_status,
                    progress: g.progress,
                    errorMessage: g.errorMessage,
                    pdfFileName: g.pdfFileName,
                    createdAt: g.createdAt,
                    updatedAt: g.updatedAt,
                    hasPdf: !!g.has_pdf,
                    tenantName: g.tenant_name || g.tenantId,
                    customerName: g.customerName || '',
                };
            }),
        });
    } catch (error) {
        console.error('[logistics/guias/history GET]', error);
        return NextResponse.json({ error: 'Failed to fetch guia history' }, { status: 500 });
    }
}
