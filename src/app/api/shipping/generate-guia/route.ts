import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
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

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const tenantId = (token as any).tenantId as string;
    if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });

    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    const userRole = (token as any)?.membershipRole;
    const orderId = new URL(request.url).searchParams.get('orderId');

    return withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const tenantPrisma = getTenantPrisma(tenantId);
      if (orderId) {
        const guia = await tenantPrisma.shippingGuia.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } });
        return NextResponse.json({ status: 'success', data: guia });
      }
      const guias = await tenantPrisma.shippingGuia.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
      return NextResponse.json({ status: 'success', data: guias });
    });
  } catch (error) {
    console.error('Error fetching guías:', error);
    return NextResponse.json({ error: 'Failed to fetch guías' }, { status: 500 });
  }
}
