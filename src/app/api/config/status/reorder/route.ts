import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

    const { statuses } = await request.json();

    if (!statuses || !Array.isArray(statuses)) {
      return NextResponse.json({ error: 'Invalid statuses data' }, { status: 400 });
    }

    // Get tenant-aware Prisma client
    const tenantPrisma = getTenantPrisma(tenantId);

    // Update each status with its new order
    const updatePromises = statuses.map((status: { id: string; order: number }) =>
      tenantPrisma.orderStatus.update({
        where: { id: status.id },
        data: { order: status.order }
      })
    );

    await Promise.all(updatePromises);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reordering statuses:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
