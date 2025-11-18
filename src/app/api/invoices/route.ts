import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPI } from '@/lib/auth-helpers';
import { withTenantContext } from '@/lib/tenantContext';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';

    return await withTenantContext({ tenantId, userId, role: (token as any)?.membershipRole, userRole: (token as any)?.membershipRole, userName }, async () => {
      // SECURITY: Always use tenant-isolated client
      const prisma = getTenantPrisma(tenantId);

      const { searchParams } = new URL(request.url);
      const status = searchParams.get('status');
      const limit = parseInt(searchParams.get('limit') || '50');

      // Build where clause (tenant filter auto-injected by middleware)
      const where: any = {};

      if (status) {
        where.paymentStatus = status;
      }

      // Get invoices (tenant-filtered automatically)
      const invoices = await prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          order: {
            select: {
              orderId: true,
              status: true
            }
          }
        }
      });

      return NextResponse.json({
        status: 'success',
        data: invoices
      });
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invoices' },
      { status: 500 }
    );
  }
}

