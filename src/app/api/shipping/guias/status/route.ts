import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { hasPermission } from '@/lib/rbac';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';

export async function GET(request: NextRequest) {
  try {
    // Pedidos or Producción only (SecureDog MEDIA-10); revocation-aware like every API route.
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    if (!hasPermission(auth.role, 'view_sales') && !hasPermission(auth.role, 'view_production')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { tenantId, userId } = auth;
    const userName = 'Authenticated user';
    const userRole = auth.role;

    const { searchParams } = new URL(request.url);
    const orderIds = searchParams.get('orderIds')?.split(',') || [];

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      const guias = await prisma.shippingGuia.findMany({
        where: {
          orderId: orderIds.length > 0 ? { in: orderIds } : undefined,
          tenantId: tenantId,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        // Never load PDF bytes for a status list; "has a PDF" comes from a light id query.
        omit: { pdfData: true },
      });
      const withPdf = guias.length
        ? new Set(
            (await prisma.shippingGuia.findMany({
              where: { tenantId, id: { in: guias.map((g) => g.id) }, pdfData: { not: null } },
              select: { id: true },
            })).map((g) => g.id),
          )
        : new Set<string>();

      const guiaOrderIds = [...new Set(guias.map((g) => g.orderId))];
      const relatedOrders = guiaOrderIds.length > 0
        ? await prisma.order.findMany({
            where: { orderId: { in: guiaOrderIds }, tenantId },
            select: {
              orderId: true,
              customerName: true,
              product: true,
              province: true,
              canton: true,
              district: true,
              quantity: true,
              phone: true,
            },
          })
        : [];
      const orderMap = new Map(relatedOrders.map((o) => [o.orderId, o]));

      return NextResponse.json({
        status: 'success',
        data: {
          guias: guias.map((g) => {
            const order = orderMap.get(g.orderId);
            return {
              id: g.id,
              orderId: g.orderId,
              carrier: g.carrier,
              guiaNumber: g.guiaNumber,
              trackingNumber: g.trackingNumber,
              status: g.status,
              progress: g.progress,
              errorMessage: g.errorMessage,
              hasPdf: withPdf.has(g.id),
              pdfFileName: g.pdfFileName,
              createdAt: g.createdAt,
              updatedAt: g.updatedAt,
              customerName: order?.customerName || null,
              product: order?.product || null,
              province: order?.province || null,
              canton: order?.canton || null,
              district: order?.district || null,
              quantity: order?.quantity || null,
              phone: order?.phone || null,
            };
          }),
        },
      });
    });
  } catch (error) {
    console.error('Error fetching guía status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch guía status' },
      { status: 500 }
    );
  }
}
