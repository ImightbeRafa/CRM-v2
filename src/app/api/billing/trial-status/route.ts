import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken, getSelectedTenantId } from '@/lib/selected-tenant';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

/**
 * Get Trial Status for Current User
 * Checks if user is in trial period and days remaining
 * Endpoint: GET /api/billing/trial-status
 */
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const selectedTenantId = getSelectedTenantId(token);
    const membership = await getMembershipForToken(token);

    if (!membership && !selectedTenantId) {
      // User doesn't have a tenant yet - return default trial status
      const defaultTrialEnd = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000); // 15 days from now
      return NextResponse.json({
        tenantId: null,
        currentPlan: 'FREE',
        subscriptionStatus: 'active',
        isInTrial: true,
        trialEndsAt: defaultTrialEnd.toISOString(),
        daysRemaining: 15,
        trialExpired: false
      });
    }

    if (!membership) {
      return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
    }

    const tenantId = membership.tenantId;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        plan: true,
        subscriptionStatus: true,
        trialEndsAt: true,
        createdAt: true
      }
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    // Check if in trial period
    const now = new Date();
    const trialEndsAt = tenant.trialEndsAt || new Date(tenant.createdAt.getTime() + 15 * 24 * 60 * 60 * 1000); // 15 days default
    const isInTrial = tenant.plan === 'FREE' && now < trialEndsAt;
    const daysRemaining = isInTrial ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;

    return NextResponse.json({
      tenantId: tenant.id,
      currentPlan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      isInTrial,
      trialEndsAt: trialEndsAt.toISOString(),
      daysRemaining,
      trialExpired: !isInTrial && tenant.plan === 'FREE' && now >= trialEndsAt
    });

  } catch (error: any) {
    console.error('❌ Error getting trial status:', error);
    return NextResponse.json({ 
      error: 'Failed to get trial status'
    }, { status: 500 });
  }
}

