import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { packPdfBuffersToA4 } from '@/lib/pdf/packPdfPages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const rawIds = Array.isArray(body?.ids) ? body.ids : [];
    const ids = rawIds
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, 100);

    if (ids.length === 0) {
      return NextResponse.json({ error: 'No guía IDs provided' }, { status: 400 });
    }

    const guias = await prisma.shippingGuia.findMany({
      where: {
        id: { in: ids },
      },
      select: {
        id: true,
        orderId: true,
        guiaNumber: true,
        pdfData: true,
        pdfFileName: true,
      },
    });

    const guiaById = new Map(guias.map((guia) => [guia.id, guia]));
    const orderedGuias = ids
      .map((id) => guiaById.get(id))
      .filter((guia): guia is NonNullable<typeof guia> => Boolean(guia));

    const validPdfBuffers = orderedGuias
      .filter((guia) => guia.pdfData)
      .map((guia) => Buffer.from(guia.pdfData as Uint8Array));

    if (validPdfBuffers.length === 0) {
      return NextResponse.json({ error: 'No PDFs available for the selected guías' }, { status: 400 });
    }

    const mergedPdf = await packPdfBuffersToA4(validPdfBuffers);
    const fileName = `guias-bulk-${new Date().toISOString().slice(0, 10)}.pdf`;

    return new NextResponse(Buffer.from(mergedPdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': mergedPdf.length.toString(),
      },
    });
  } catch (error) {
    console.error('[logistics/guias/download-bulk POST]', error);
    return NextResponse.json({ error: 'Failed to create bulk PDF download' }, { status: 500 });
  }
}
