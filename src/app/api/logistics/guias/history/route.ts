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
 * Returns recent ShippingGuia records across all managed tenants.
 */
export async function GET(req: NextRequest) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const { searchParams } = new URL(req.url);
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
        const carrier = searchParams.get('carrier') || undefined;

        const where: any = {
            tenantId: { in: MANAGED_TENANT_IDS },
        };
        if (carrier) where.carrier = carrier;

        const guias = await prisma.shippingGuia.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
            select: {
                id: true,
                tenantId: true,
                orderId: true,
                carrier: true,
                guiaNumber: true,
                trackingNumber: true,
                status: true,
                progress: true,
                errorMessage: true,
                pdfFileName: true,
                createdAt: true,
                updatedAt: true,
                // Exclude pdfData from listing (too large)
            },
        });

        const pdfChecks = await prisma.shippingGuia.findMany({
            where: { id: { in: guias.map(g => g.id) } },
            select: { id: true, pdfData: true },
        });
        const pdfSet = new Set(pdfChecks.filter(p => p.pdfData).map(p => p.id));
        const guiasWithPdfCheck = guias.map(g => ({ ...g, hasPdf: pdfSet.has(g.id) }));

        // Get tenant names for enrichment
        const tenants = await prisma.tenant.findMany({
            where: { id: { in: MANAGED_TENANT_IDS } },
            select: { id: true, name: true },
        });
        const tenantNames: Record<string, string> = {};
        for (const t of tenants) tenantNames[t.id] = t.name || t.id;

        // Get customer names by looking up orders
        const orderIds = [...new Set(guias.map(g => g.orderId))];
        const orders = orderIds.length > 0
            ? await prisma.order.findMany({
                where: {
                    orderId: { in: orderIds },
                    tenantId: { in: MANAGED_TENANT_IDS },
                },
                select: { orderId: true, tenantId: true, customerName: true },
            })
            : [];
        const customerNameMap: Record<string, string> = {};
        for (const o of orders) customerNameMap[`${o.tenantId}:${o.orderId}`] = o.customerName;

        return NextResponse.json({
            guias: guiasWithPdfCheck.map(g => ({
                ...g,
                tenantName: tenantNames[g.tenantId] || g.tenantId,
                customerName: customerNameMap[`${g.tenantId}:${g.orderId}`] || '',
            })),
        });
    } catch (error) {
        console.error('[logistics/guias/history GET]', error);
        return NextResponse.json({ error: 'Failed to fetch guía history' }, { status: 500 });
    }
}
