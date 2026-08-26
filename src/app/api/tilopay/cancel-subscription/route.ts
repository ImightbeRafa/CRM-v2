import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { getSelectedTenantMembership } from '@/lib/selected-tenant';
import { cancelTilopayRepeatPlan, TilopayCancellationError } from '@/lib/tilopay-repeat';

/**
 * Cancel Tilopay Subscription
 * 
 * Endpoint: POST /api/tilopay/cancel-subscription
 * 
 * Flow:
 * 1. User requests cancellation
 * 2. Cancel subscription with Tilopay (stop future charges)
 * 3. Mark subscription as cancelled in DB
 * 4. Keep access until end of current billing period
 * 5. NEVER delete tenant data - downgrade to FREE plan
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚫 [cancel-subscription] Starting cancellation flow...');

    // Authenticate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionUser = session.user as any;
    const userId = String(sessionUser.id || '');
    const tenantId = String(sessionUser.tenantId || '');
    const membership = await getSelectedTenantMembership(userId, tenantId);

    if (!membership) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the tenant owner can manage billing' }, { status: 403 });
    }

    const tenant = membership.tenant;
    const user = membership.user;

    // Check if tenant has active subscription
    if (!tenant.tilopaySubscriptionId || tenant.plan === 'FREE') {
      return NextResponse.json({
        error: 'No active subscription to cancel',
        currentPlan: tenant.plan
      }, { status: 400 });
    }

    await cancelTilopayRepeatPlan(tenant.tilopaySubscriptionId);

    // Step 2: Update tenant in our database
    // IMPORTANT: Keep subscription active until period end, then downgrade to FREE
    const now = new Date();
    const currentPeriodEnd = tenant.currentPeriodEnd || now;

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionStatus: 'cancelled',
        cancelAtPeriodEnd: true,
        // Keep currentPeriodEnd unchanged - user has access until then
        // Plan stays BASIC until period end
      }
    });

    console.log(`✅ [cancel-subscription] Tenant ${tenantId} marked as cancelled`);
    console.log(`ℹ️ Access continues until: ${currentPeriodEnd.toISOString()}`);
    console.log(`ℹ️ Will automatically downgrade to FREE plan after expiry`);

    // Create audit log
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          userId: user.id,
          userName: user.name || user.email || 'User',
          userRole: 'OWNER',
          action: 'UPDATE',
          entityType: 'subscription',
          entityId: tenant.tilopaySubscriptionId || 'unknown',
          entityName: `${tenant.plan} Subscription Cancellation`,
          oldValues: {
            plan: tenant.plan,
            status: tenant.subscriptionStatus,
            cancelAtPeriodEnd: tenant.cancelAtPeriodEnd
          },
          newValues: {
            plan: tenant.plan,
            status: 'cancelled',
            cancelAtPeriodEnd: true,
            accessUntil: currentPeriodEnd.toISOString(),
            note: 'Subscription cancelled by user - access continues until period end, then downgrades to FREE'
          }
        }
      });
    } catch (auditError) {
      console.error('⚠️ Failed to create audit log:', auditError);
    }

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled successfully',
      accessUntil: currentPeriodEnd.toISOString(),
      note: 'Your access continues until the end of your billing period. You will then be downgraded to the FREE plan. Your data will be preserved.',
      currentPlan: tenant.plan,
      newStatus: 'cancelled'
    });

  } catch (error: any) {
    if (error instanceof TilopayCancellationError) {
      return NextResponse.json({
        error: error.message,
        code: error.code,
      }, { status: error.code === 'not_configured' ? 503 : 502 });
    }
    console.error('❌ [cancel-subscription] Error:', error?.name || 'unknown_error');
    return NextResponse.json({
      error: 'Failed to cancel subscription'
    }, { status: 500 });
  }
}
