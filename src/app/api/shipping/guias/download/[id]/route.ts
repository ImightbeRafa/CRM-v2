import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { hasPermission } from '@/lib/rbac';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { prisma as globalPrisma } from '@/lib/db';
import { getCorreosAutomatedShippingCost } from '@/lib/correos-gam-pricing';
import { stampCorreosGamZoneOnPdf } from '@/lib/pdf/correosGamStamp';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: guiaId } = await params;
    // Pedidos or Producción only (SecureDog MEDIA-10); revocation-aware like every API route.
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    if (!hasPermission(auth.role, 'view_sales') && !hasPermission(auth.role, 'view_production')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { tenantId, userId } = auth;
    const userName = 'Authenticated user';
    const userRole = auth.role;

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      // Get guía with PDF data
      const guia = await prisma.shippingGuia.findFirst({
        where: {
          id: guiaId,
          tenantId: tenantId
        },
        select: {
          id: true,
          carrier: true,
          pdfData: true,
          pdfFileName: true,
          orderId: true,
          guiaNumber: true
        }
      });

      if (!guia) {
        return NextResponse.json({ error: 'Guía not found' }, { status: 404 });
      }

      if (!guia.pdfData) {
        return NextResponse.json({ error: 'PDF not available for this guía' }, { status: 404 });
      }

      // Return PDF as downloadable file
      const fileName = guia.pdfFileName || `guia-${guia.guiaNumber}.pdf`;
      const zone = guia.carrier === 'correos_cr'
        ? await resolveCurrentGuiaGamZone(prisma, tenantId, guia.orderId)
        : null;
      const pdfData = zone
        ? await stampCorreosGamZoneOnPdf(Buffer.from(guia.pdfData), zone)
        : Buffer.from(guia.pdfData);
      
      return new NextResponse(Buffer.from(pdfData), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': pdfData.length.toString()
        }
      });
    });
  } catch (error) {
    console.error('Error downloading PDF:', error);
    return NextResponse.json(
      { error: 'Failed to download PDF' },
      { status: 500 }
    );
  }
}

async function resolveCurrentGuiaGamZone(prisma: ReturnType<typeof getTenantPrisma>, tenantId: string, orderId: string) {
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
    const rows = await globalPrisma.$queryRaw<{ archived_at: Date | null }[]>`
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
