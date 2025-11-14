import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (token as any).tenantId as string;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    const userRole = (token as any)?.membershipRole;

    const { searchParams } = new URL(request.url);
    const orderIds = searchParams.get('orderIds')?.split(',') || [];

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      
      // Get guías for the specified orders
      const guias = await prisma.shippingGuia.findMany({
        where: {
          orderId: orderIds.length > 0 ? { in: orderIds } : undefined,
          tenantId: tenantId
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 50 // Limit to recent 50
      });

      return NextResponse.json({
        status: 'success',
        data: {
          guias: guias.map(g => ({
            id: g.id,
            orderId: g.orderId,
            carrier: g.carrier,
            guiaNumber: g.guiaNumber,
            trackingNumber: g.trackingNumber,
            status: g.status,
            progress: g.progress,
            errorMessage: g.errorMessage,
            hasPdf: !!g.pdfData,
            pdfFileName: g.pdfFileName,
            createdAt: g.createdAt,
            updatedAt: g.updatedAt
          }))
        }
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
