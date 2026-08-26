import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken } from '@/lib/selected-tenant';
import { cancelTilopayRepeatPlan, TilopayCancellationError } from '@/lib/tilopay-repeat';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const membership = await getMembershipForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the tenant owner can cancel billing' }, { status: 403 });
    }

    const { feedback } = await request.json();
    const tenantId = membership.tenantId;
    const tenant = membership.tenant;

    if (tenant.plan === 'FREE') {
      return NextResponse.json({ error: 'No active subscription to cancel' }, { status: 400 });
    }

    if (!tenant.tilopaySubscriptionId) {
      return NextResponse.json({
        error: 'This subscription cannot be cancelled through self-service',
        code: 'provider_subscription_missing',
      }, { status: 409 });
    }

    await cancelTilopayRepeatPlan(tenant.tilopaySubscriptionId);

    // Update tenant - mark for cancellation at period end
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        cancelAtPeriodEnd: true,
        subscriptionStatus: 'canceling'
      }
    });

    // Log feedback if provided
    if (feedback) {
      // Store feedback in audit log
      try {
        await prisma.auditLog.create({
          data: {
            tenantId,
            userId: token.sub,
            userName: token.email || 'Unknown',
            userRole: 'OWNER',
            action: 'UPDATE',
            entityType: 'subscription',
            entityId: tenant.tilopaySubscriptionId || 'unknown',
            entityName: 'Subscription Cancellation',
            reason: feedback,
            oldValues: { plan: tenant.plan, status: 'active' },
            newValues: { plan: 'FREE', status: 'canceling' }
          }
        });
      } catch (auditError) {
        console.error('Failed to log cancellation audit:', auditError);
      }
    }

    return NextResponse.json({
      status: 'success',
      data: {
        message: 'Subscription will be canceled at the end of the billing period',
        providerConfirmed: true,
      }
    });
  } catch (error) {
    if (error instanceof TilopayCancellationError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
      }, { status: error.code === 'not_configured' ? 503 : 502 });
    }
    console.error('Error canceling subscription:', error instanceof Error ? error.name : 'unknown_error');
    return NextResponse.json(
      { error: 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}

