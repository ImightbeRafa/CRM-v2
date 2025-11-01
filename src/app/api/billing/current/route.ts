import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user and their tenant through memberships
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        defaultTenantId: true,
        memberships: {
          where: { isActive: true },
          select: {
            tenantId: true,
            tenant: {
              select: {
                id: true,
                plan: true,
                subscriptionStatus: true,
                currentPeriodEnd: true,
                cancelAtPeriodEnd: true,
                stripeCustomerId: true,
                stripeSubscriptionId: true,
                tilopaySubscriptionId: true
              }
            }
          },
          take: 1
        }
      }
    });

    if (!user) {
      console.error('❌ User not found for token.sub:', token.sub);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.memberships || user.memberships.length === 0) {
      // User doesn't have a tenant yet - return default FREE plan
      console.log('⚠️ User has no memberships, returning default FREE plan:', { userId: user.id });
      return NextResponse.json({
        status: 'success',
        data: {
          name: 'FREE',
          status: 'active',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          stripeCustomerId: null,
          stripeSubscriptionId: null,
          tilopaySubscriptionId: null
        }
      });
    }

    const tenant = user.memberships[0].tenant;

    console.log('📊 Billing API - Current plan:', tenant.plan, 'Status:', tenant.subscriptionStatus);

    return NextResponse.json({
      status: 'success',
      data: {
        name: tenant.plan,
        status: tenant.subscriptionStatus || 'active',
        currentPeriodEnd: tenant.currentPeriodEnd?.toISOString() || null,
        cancelAtPeriodEnd: tenant.cancelAtPeriodEnd || false,
        stripeCustomerId: tenant.stripeCustomerId,
        stripeSubscriptionId: tenant.stripeSubscriptionId,
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

