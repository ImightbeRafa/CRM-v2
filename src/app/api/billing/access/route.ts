import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { evaluateTenantAccess } from '@/lib/billing-access';
import { getMembershipForToken } from '@/lib/selected-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await getMembershipForToken(token);
  if (!membership) {
    return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
  }

  try {
    const access = await evaluateTenantAccess(membership.tenantId);
    return NextResponse.json({ status: 'success', data: access });
  } catch (error) {
    console.error('[BillingAccess] Access read failed', {
      code: error instanceof Error ? error.name : 'evaluation_error',
    });
    return NextResponse.json({ error: 'Unable to evaluate billing access' }, { status: 503 });
  }
}
