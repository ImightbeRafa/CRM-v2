import { NextRequest, NextResponse } from 'next/server';
import { getLiveToken } from '@/lib/live-token';
import { evaluateTenantAccess, evaluateTenantAccessCached } from '@/lib/billing-access';
import { getMembershipSummaryForToken } from '@/lib/selected-tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const token = await getLiveToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await getMembershipSummaryForToken(token);
  if (!membership) {
    return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
  }

  try {
    // ?fresh=1 (billing screen, post-payment re-checks) always reads the database; the banner on
    // every page uses the 30 s cache.
    const fresh = request.nextUrl.searchParams.get('fresh') === '1';
    const access = fresh
      ? await evaluateTenantAccess(membership.tenantId)
      : await evaluateTenantAccessCached(membership.tenantId);
    return NextResponse.json({ status: 'success', data: access });
  } catch (error) {
    console.error('[BillingAccess] Access read failed', {
      code: error instanceof Error ? error.name : 'evaluation_error',
    });
    return NextResponse.json({ error: 'Unable to evaluate billing access' }, { status: 503 });
  }
}
