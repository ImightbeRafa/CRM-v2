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

        // Check if PDF exists for each guia
        const guiasWithPdfCheck = await Promise.all(
            guias.map(async (g) => {
                let hasPdf = false;
                try {
                    const pdfCheck = await prisma.shippingGuia.findFirst({
                        where: { id: g.id },
                        select: { pdfData: true },
                    });
                    hasPdf = !!(pdfCheck?.pdfData);
                } catch {
                    // Skip check on error
                }
                return { ...g, hasPdf };
            })
        );

        // Get tenant names for enrichment
        const tenants = await prisma.tenant.findMany({
            where: { id: { in: MANAGED_TENANT_IDS } },
            select: { id: true, name: true },
        });
        const tenantNames: Record<string, string> = {};
        for (const t of tenants) tenantNames[t.id] = t.name || t.id;

        return NextResponse.json({
            guias: guiasWithPdfCheck.map(g => ({
                ...g,
                tenantName: tenantNames[g.tenantId] || g.tenantId,
            })),
        });
    } catch (error) {
        console.error('[logistics/guias/history GET]', error);
        return NextResponse.json({ error: 'Failed to fetch guía history' }, { status: 500 });
    }
}
