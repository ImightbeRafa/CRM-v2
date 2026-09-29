import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { recordActivity } from '@/lib/activity';
import { generateGuiasForOrders } from '@/lib/bot/guia-service';

const DELIVERY_TYPES = ['Domicilio', 'Sucursal', 'Punto de correo'] as const;

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_production');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role: userRole } = auth;
    const body = await request.json();
    const { orderIds, carrier = 'correos_cr', deliveryType = 'Domicilio', verifiedLocations } = body;

    if (!Array.isArray(orderIds) || orderIds.length === 0 || orderIds.some(id => typeof id !== 'string')) {
      return NextResponse.json({ error: 'Order IDs are required' }, { status: 400 });
    }
    if (!DELIVERY_TYPES.includes(deliveryType)) {
      return NextResponse.json({ error: 'Invalid deliveryType' }, { status: 400 });
    }

    return withTenantContext({ tenantId, userId, role: userRole, userRole, userName: 'Authenticated user' }, async () => {
      const batch = await generateGuiasForOrders(tenantId, orderIds, carrier, {
        deliveryType,
        verifiedLocations: Array.isArray(verifiedLocations) ? verifiedLocations : [],
        adapter: 'tenant-guia',
        userId,
        concurrency: 3,
        timeoutMs: 20_000,
      });
      // Activity: internal Order.id (same id every other event uses), allow-listed enums only.
      const okNumbers = batch.results.filter((r) => r.success).map((r) => r.orderId);
      if (okNumbers.length) {
        const idByNumber = new Map(
          (await prisma.order.findMany({ where: { tenantId, orderId: { in: okNumbers } }, select: { id: true, orderId: true } }))
            .map((o) => [o.orderId, o.id]),
        );
        const surface = ['chats', 'pedidos', 'produccion'].includes(body.surface) ? body.surface : 'produccion';
        for (const number of okNumbers) {
          const id = idByNumber.get(number);
          if (!id) continue;
          void recordActivity({
            tenantId,
            actorUserId: userId,
            verb: 'guia.generate',
            entityType: 'Order',
            entityId: id,
            orderId: id,
            surface,
            props: { carrier: carrier === 'correos_cr' ? 'correos_cr' : 'other', deliveryType },
          });
        }
      }
      return NextResponse.json({
        status: 'success',
        data: {
          results: batch.results.map(result => ({
            success: result.success,
            orderId: result.orderId,
            guiaNumber: result.guiaNumber,
            trackingNumber: result.trackingNumber,
            error: result.error,
            pdfDownloaded: Boolean(result.pdfBuffer),
          })),
          successful: batch.successful,
          failed: batch.failed,
        },
      });
    });
  } catch (error) {
    console.error('Error generating guías:', error);
    return NextResponse.json({ error: 'Failed to generate guías' }, { status: 500 });
  }
}

/**
 * Guía metadata. Security (AUTH-38, 2026-09-29): was raw getToken (no permission, no revocation)
 * and returned the label PDFs (customer name / address / phone) in bulk. Now: view_production,
 * revocation-aware, and never the PDF bytes (downloads go through /api/shipping/guias/download).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_production');
    if (!auth.ok) return auth.response;
    const { tenantId, userId, role: userRole } = auth;
    const orderId = new URL(request.url).searchParams.get('orderId');

    return withTenantContext({ tenantId, userId, role: userRole, userRole, userName: 'Authenticated user' }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId);
      if (orderId) {
        const guia = await tenantPrisma.shippingGuia.findFirst({ where: { tenantId, orderId }, orderBy: { createdAt: 'desc' }, omit: { pdfData: true } });
        return NextResponse.json({ status: 'success', data: guia });
      }
      const guias = await tenantPrisma.shippingGuia.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 100, omit: { pdfData: true } });
      return NextResponse.json({ status: 'success', data: guias });
    });
  } catch (error) {
    console.error('Error fetching guías:', error);
    return NextResponse.json({ error: 'Failed to fetch guías' }, { status: 500 });
  }
}
