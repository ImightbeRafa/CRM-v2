import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { evaluateTenantAccess } from '@/lib/billing-access';
import { getMembershipForToken, getSelectedTenantId } from '@/lib/selected-tenant';

export const dynamic = 'force-dynamic';

/** Compatibility response backed by the canonical fresh-DB access evaluator. */
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const selectedTenantId = getSelectedTenantId(token);
    const membership = await getMembershipForToken(token);
    if (!membership && !selectedTenantId) {
      return NextResponse.json({
        tenantId: null,
        currentPlan: 'FREE',
        subscriptionStatus: 'setup',
        state: 'ACTIVE',
        isInTrial: false,
        trialEndsAt: null,
        graceEndsAt: null,
        daysRemaining: 0,
        trialExpired: false,
      });
    }
    if (!membership) {
      return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
    }

    const access = await evaluateTenantAccess(membership.tenantId);
    const trialEnd = access.trialEndsAt ? new Date(access.trialEndsAt) : null;
    const isInTrial = access.plan === 'FREE' && access.state === 'ACTIVE' && Boolean(trialEnd);
    const daysRemaining = isInTrial && trialEnd
      ? Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
      : 0;

    return NextResponse.json({
      tenantId: access.tenantId,
      currentPlan: access.plan,
      subscriptionStatus: access.subscriptionStatus,
      state: access.state,
      enforced: access.enforced,
      isInTrial,
      trialEndsAt: access.trialEndsAt,
      graceEndsAt: access.graceEndsAt,
      daysRemaining,
      trialExpired: access.state === 'RESTRICTED',
    });
  } catch (error) {
    console.error('[BillingAccess] Trial compatibility read failed', {
      code: error instanceof Error ? error.name : 'evaluation_error',
    });
    return NextResponse.json({ error: 'Failed to get billing access' }, { status: 503 });
  }
}
