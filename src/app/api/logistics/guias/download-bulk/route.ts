import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { guardLogisticsApi } from '@/lib/logistics-auth';
import { packPdfBuffersToA4 } from '@/lib/pdf/packPdfPages';
import { getCorreosAutomatedShippingCost } from '@/lib/correos-gam-pricing';
import { stampCorreosGamZoneOnPdf } from '@/lib/pdf/correosGamStamp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const guard = await guardLogisticsApi(req);
  if (guard) return guard;

  try {
    const body = await req.json();
    const rawIds = Array.isArray(body?.ids) ? body.ids : [];
    const maxBulkDownload = 500;
    const ids = rawIds
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .slice(0, maxBulkDownload);

    if (ids.length === 0) {
      return NextResponse.json({ error: 'No guía IDs provided' }, { status: 400 });
    }

    if (rawIds.length > maxBulkDownload) {
      return NextResponse.json({ error: `Maximum ${maxBulkDownload} guias per bulk download` }, { status: 400 });
    }

    const guias = await prisma.shippingGuia.findMany({
      where: {
        id: { in: ids },
      },
      select: {
        id: true,
        tenantId: true,
        orderId: true,
        guiaNumber: true,
        pdfData: true,
        pdfFileName: true,
      },
    });

    const guiaById = new Map(guias.map((guia: any) => [guia.id, guia]));
    const orderedGuias = ids
      .map((id: string) => guiaById.get(id))
      .filter((guia: any): guia is any => Boolean(guia));

    const zoneByGuiaId = await resolveCurrentGuiaGamZones(orderedGuias);
    const validPdfBuffers = await Promise.all(
      orderedGuias
        .filter((guia: any) => guia.pdfData)
        .map((guia: any) =>
          stampCorreosGamZoneOnPdf(
            Buffer.from(guia.pdfData as Uint8Array),
            zoneByGuiaId.get(guia.id) ?? null
          )
        )
    );

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

async function resolveCurrentGuiaGamZones(guias: Array<{ id: string; tenantId: string; orderId: string }>) {
  const zoneByGuiaId = new Map<string, 'gam' | 'outside_gam'>();
  if (guias.length === 0) return zoneByGuiaId;

  const orders = await prisma.order.findMany({
    where: {
      OR: guias.map((guia) => ({
        tenantId: guia.tenantId,
        orderId: guia.orderId,
      })),
    },
    select: {
      id: true,
      tenantId: true,
      orderId: true,
      province: true,
      canton: true,
      district: true,
    },
  });

  const archivedOrderIds = new Set<string>();
  try {
    const crmOrderIds = orders.map((order) => order.id);
    if (crmOrderIds.length > 0) {
      const rows = await prisma.$queryRaw<{ crm_order_id: string }[]>`
        SELECT crm_order_id FROM lm_orders
        WHERE crm_order_id = ANY(${crmOrderIds}::text[])
          AND archived_at IS NOT NULL
      `;
      for (const row of rows) archivedOrderIds.add(row.crm_order_id);
    }
  } catch {
    // If logistics metadata is unavailable, still allow labels to be marked from CRM location data.
  }

  const orderByTenantAndOrderId = new Map(
    orders.map((order) => [`${order.tenantId}:${order.orderId}`, order])
  );

  for (const guia of guias) {
    const order = orderByTenantAndOrderId.get(`${guia.tenantId}:${guia.orderId}`);
    if (!order || archivedOrderIds.has(order.id)) continue;

    const calculated = getCorreosAutomatedShippingCost({
      province: order.province,
      canton: order.canton,
      district: order.district,
    });
    if (calculated.zone) zoneByGuiaId.set(guia.id, calculated.zone);
  }

  return zoneByGuiaId;
}
