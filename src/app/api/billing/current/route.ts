import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken, getSelectedTenantId } from '@/lib/selected-tenant';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const selectedTenantId = getSelectedTenantId(token);
    const membership = await getMembershipForToken(token);

    if (!membership && !selectedTenantId) {
      // User doesn't have a tenant yet - return default FREE plan
      return NextResponse.json({
        status: 'success',
        data: {
          name: 'FREE',
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          tilopaySubscriptionId: null
        }
      });
    }

    if (!membership) {
      return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
    }

    const tenant = membership.tenant;

    console.log('📊 Billing API - Current plan:', tenant.plan, 'Status:', tenant.subscriptionStatus);

    return NextResponse.json({
      status: 'success',
      data: {
        name: tenant.plan,
        status: tenant.subscriptionStatus || 'active',
        currentPeriodEnd: tenant.currentPeriodEnd?.toISOString() || null,
        cancelAtPeriodEnd: tenant.cancelAtPeriodEnd || false,
        tilopaySubscriptionId: tenant.tilopaySubscriptionId
      }
    });
  } catch (error) {
    console.error('Error fetching current plan:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current plan' },
      { status: 500 }
    );
  }
}

