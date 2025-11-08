import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';

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

    const token = session.user as any;
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      include: {
        memberships: {
          where: { isActive: true },
          include: { tenant: true }
        }
      }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const tenant = user.memberships[0].tenant;
    const tenantId = tenant.id;

    console.log(`👤 [cancel-subscription] User authenticated: ${user.id}, Tenant: ${tenantId}`);

    // Check if tenant has active subscription
    if (!tenant.tilopaySubscriptionId || tenant.plan === 'FREE') {
      return NextResponse.json({
        error: 'No active subscription to cancel',
        currentPlan: tenant.plan
      }, { status: 400 });
    }

    // Step 1: Cancel subscription with Tilopay
    // Tilopay Repeat API - unsubscribe endpoint
    const apiUser = process.env.TILOPAY_USER;
    const apiPassword = process.env.TILOPAY_PASSWORD;
    const apiBaseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiUser || !apiPassword) {
      return NextResponse.json({
        error: 'Tilopay credentials not configured'
      }, { status: 500 });
    }

    // Authenticate with Tilopay
    console.log('🔐 Authenticating with Tilopay...');
    const loginResponse = await fetch(`${apiBaseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiuser: apiUser,
        password: apiPassword
      })
    });

    if (!loginResponse.ok) {
      const loginError = await loginResponse.text();
      console.error('❌ Tilopay login failed:', loginResponse.status, loginError);
      return NextResponse.json({
        error: 'Failed to authenticate with payment provider'
      }, { status: 500 });
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.access_token;

    // Cancel the subscription via Tilopay
    console.log(`🚫 Cancelling Tilopay subscription: ${tenant.tilopaySubscriptionId}`);
    
    try {
      const cancelResponse = await fetch(`${apiBaseUrl}/unsubscribePlan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          id_plan: tenant.tilopaySubscriptionId
        })
      });

      const cancelData = await cancelResponse.json();
      console.log('📥 Tilopay cancel response:', cancelData);

      if (cancelResponse.ok && cancelData.type === '200') {
        console.log('✅ Subscription cancelled with Tilopay');
      } else {
        console.warn('⚠️ Tilopay cancellation response non-200:', cancelData);
        // Continue anyway - update our DB even if Tilopay API has issues
      }
    } catch (tilopayError: any) {
      console.error('❌ Tilopay cancellation API error:', tilopayError);
      // Continue - we'll still mark as cancelled in our DB
    }

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
    console.error('❌ [cancel-subscription] Error:', error);
    return NextResponse.json({
      error: error.message || 'Failed to cancel subscription',
      details: error.toString()
    }, { status: 500 });
  }
}
