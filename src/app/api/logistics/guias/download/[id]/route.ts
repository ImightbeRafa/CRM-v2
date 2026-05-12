import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { getCorreosAutomatedShippingCost } from '@/lib/correos-gam-pricing';
import { stampCorreosGamZoneOnPdf } from '@/lib/pdf/correosGamStamp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/guias/download/[id]
 * 
 * Downloads a PDF for a specific ShippingGuia record.
 * Logistics admin only — no tenant scoping.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const guard = await guardLogisticsApi(req);
    if (guard) return guard;

    try {
        const { id: guiaId } = await params;

        const guia = await prisma.shippingGuia.findFirst({
            where: { id: guiaId },
            select: {
                id: true,
                tenantId: true,
                pdfData: true,
                pdfFileName: true,
                orderId: true,
                guiaNumber: true,
            },
        });

        if (!guia) {
            return NextResponse.json({ error: 'Guía not found' }, { status: 404 });
        }

        if (!guia.pdfData) {
            return NextResponse.json({ error: 'PDF not available for this guía' }, { status: 404 });
        }

        const fileName = guia.pdfFileName || `guia-${guia.guiaNumber || guia.orderId}.pdf`;
        const zone = await resolveCurrentGuiaGamZone(guia.tenantId, guia.orderId);
        const pdfData = zone
            ? await stampCorreosGamZoneOnPdf(Buffer.from(guia.pdfData), zone)
            : Buffer.from(guia.pdfData);

        return new NextResponse(Buffer.from(pdfData), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': pdfData.length.toString(),
            },
        });
    } catch (error) {
        console.error('[logistics/guias/download GET]', error);
        return NextResponse.json({ error: 'Failed to download PDF' }, { status: 500 });
    }
}

async function resolveCurrentGuiaGamZone(tenantId: string, orderId: string) {
    const order = await prisma.order.findFirst({
        where: { tenantId, orderId },
        select: {
            id: true,
            province: true,
            canton: true,
            district: true,
        },
    });

    if (!order) return null;

    try {
        const rows = await prisma.$queryRaw<{ archived_at: Date | null }[]>`
            SELECT archived_at FROM lm_orders WHERE crm_order_id = ${order.id} LIMIT 1
        `;
        if (rows[0]?.archived_at) return null;
    } catch {
        // If logistics metadata is unavailable, still allow the label to be marked from CRM location data.
    }

    return getCorreosAutomatedShippingCost({
        province: order.province,
        canton: order.canton,
        district: order.district,
    }).zone;
}
