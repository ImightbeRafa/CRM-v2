import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request });
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const membership = user.memberships[0];
    const tenantId = membership.tenantId;

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
