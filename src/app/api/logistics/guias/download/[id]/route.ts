import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';

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

        return new NextResponse(Buffer.from(guia.pdfData), {
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Content-Length': guia.pdfData.length.toString(),
            },
        });
    } catch (error) {
        console.error('[logistics/guias/download GET]', error);
        return NextResponse.json({ error: 'Failed to download PDF' }, { status: 500 });
    }
}
