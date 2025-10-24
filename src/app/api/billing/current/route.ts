import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

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

    if (!user || !user.memberships || user.memberships.length === 0) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
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

