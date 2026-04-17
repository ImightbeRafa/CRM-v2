import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { getTenantPrisma } from '@/lib/prisma-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;

    const tenantPrisma = getTenantPrisma(auth.tenantId);
    const orders = await tenantPrisma.order.findMany({
      orderBy: { timestamp: 'desc' },
      take: 1000,
    });

    return NextResponse.json({ status: 'success', data: orders });
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : '';
    // Handle missing table during first run before migrations
    if (error?.code === 'P2021' || message.includes('no such table')) {
      return NextResponse.json({ status: 'success', data: [] });
    }
    return NextResponse.json(
      { status: 'error', error: message || 'Failed to fetch sales data' },
      { status: 500 }
    );
  }
}
