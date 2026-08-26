import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';
import { getMembershipForToken } from '@/lib/selected-tenant';

const HOSTED_PLAN_PRICING = {
  basic: { name: 'Básico', amount: 10000, currency: 'CRC' },
  pro: { name: 'Pro', amount: 10000, currency: 'CRC' },
} as const;

/**
 * Create Recurring Subscription Plan via Tilopay /createPlanRepeat
 * 
 * Uses Tilopay's Repeat API for recurring subscriptions
 * Returns a hosted URL where user completes payment
 * Webhooks handle subscription events (subscribe, renew, cancel, etc.)
 * 
 * Endpoint: POST /api/tilopay/create-plan-repeat
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔄 [create-plan-repeat] Starting recurring subscription flow...');
    
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      console.error('❌ [create-plan-repeat] Unauthorized - no token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const planId = String(body?.planId || '').toLowerCase() as keyof typeof HOSTED_PLAN_PRICING;
    const selectedPlan = HOSTED_PLAN_PRICING[planId];

    if (!selectedPlan) {
      return NextResponse.json({ 
        error: 'Invalid or unavailable plan'
      }, { status: 400 });
    }

    const membership = await getMembershipForToken(token);
    if (!membership) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    if (membership.role !== 'OWNER') {
      return NextResponse.json({ error: 'Only the tenant owner can manage billing' }, { status: 403 });
    }

    const tenantId = membership.tenantId;
    const user = membership.user;
    const { name: planName, amount, currency } = selectedPlan;

    // Step 1: Authenticate with Tilopay to get bearer token
    console.log('🔐 Authenticating with Tilopay...');
    
    const apiUser = process.env.TILOPAY_USER;
    const apiPassword = process.env.TILOPAY_PASSWORD;
    const apiKey = process.env.TILOPAY_API_KEY;
    const apiBaseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      console.error('❌ Missing Tilopay credentials');
      return NextResponse.json({ 
        error: 'Payment system not configured',
        details: 'Missing TILOPAY_USER, TILOPAY_PASSWORD, or TILOPAY_API_KEY in environment'
      }, { status: 500 });
    }

    const loginResponse = await fetch(`${apiBaseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiuser: apiUser,
        password: apiPassword
      })
    });

    if (!loginResponse.ok) {
      console.error('❌ Tilopay login failed:', loginResponse.status);
      return NextResponse.json({ 
        error: 'Failed to authenticate with payment provider',
        status: loginResponse.status
      }, { status: 500 });
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.access_token;

    if (!accessToken) {
      console.error('❌ No access token in response:', loginData);
      return NextResponse.json({ 
        error: 'Invalid authentication response - no access token'
      }, { status: 500 });
    }

    console.log('✅ Bearer token obtained, expires in:', loginData.expires_in || '86400s');

    // Step 2: Create recurring plan with proper Tilopay parameters
    const [firstName, ...lastNameParts] = (user.name || 'Customer User').split(' ');
    const lastName = lastNameParts.join(' ') || 'User';

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    const webhookUrl = `${baseUrl}/api/tilopay/webhook`;
    const thanksUrl = `${baseUrl}/config?tab=billing&status=success`;

    const planPayload = {
      key: process.env.TILOPAY_API_KEY,
      title: `Suscripción ${planName} Mensual`,  // REQUIRED
      description: `Acceso mensual al plan ${planName}`,
      frecuency: 3,  // REQUIRED: 3 = Monthly (per Tilopay docs)
      currency: currency,  // ISO 4217
      first_amount: 0,  // Initial charge (0 = no upfront payment, charge starts next cycle)
      trial: 0,  // No trial period
      trial_days: 0,
      attempts: 3,  // Retry attempts for failed payments
      modality: [  // REQUIRED: Array of plan tiers
        { 
          title: planName, 
          amount: amount 
        }
      ],
      thanks_url: thanksUrl,  // Redirect after successful payment
      webhook_subscribe: webhookUrl,  // Called when user subscribes
      webhook_payment: webhookUrl,  // Called on successful recurring payment
      webhook_rejected: webhookUrl,  // Called on payment failure
      webhook_unsubscribe: webhookUrl,  // Called when user cancels
      webhook_reactive: webhookUrl,  // Called when subscription reactivated
      end_at: '',  // Empty = no end date (continues until cancelled)
      notify: 0  // No extra notifications
    };

    console.log('📦 Creating recurring plan...');

    // Use the same apiBaseUrl from authentication above
    const planResponse = await fetch(`${apiBaseUrl}/createPlanRepeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(planPayload)
    });

    console.log('📥 Plan creation response status:', planResponse.status);

    if (!planResponse.ok) {
      console.error('❌ Plan creation failed:', planResponse.status);
      return NextResponse.json({ 
        error: 'Failed to create subscription plan'
      }, { status: 500 });
    }

    const planData = await planResponse.json();
    // Expected response: { type: '200', id: 624, url: 'https://app.tilopay.com/link/TmpJMHwx' }
    if (planData.type === '200' && planData.url) {
      const paymentUrl = planData.url;
      const tilopayPlanId = planData.id;
      
      const correlationId = String(tilopayPlanId);
      const conflictingTenant = await prisma.tenant.findFirst({
        where: { tilopaySubscriptionId: correlationId, id: { not: tenantId } },
        select: { id: true },
      });
      if (conflictingTenant) {
        console.error('❌ Tilopay correlation ID is not unique');
        return NextResponse.json({ error: 'Payment correlation conflict' }, { status: 409 });
      }

      // Persist correlation before returning the hosted URL. Paid entitlement
      // remains unchanged until a verified webhook confirms payment.
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          tilopaySubscriptionId: correlationId,
          settings: {
            ...((membership.tenant.settings && typeof membership.tenant.settings === 'object' && !Array.isArray(membership.tenant.settings))
              ? membership.tenant.settings as Record<string, unknown>
              : {}),
            billingPendingCheckout: {
              provider: 'tilopay',
              correlationId,
              plan: planId.toUpperCase(),
              amount,
              currency,
              createdAt: new Date().toISOString(),
            },
          },
        }
      });
      
      return NextResponse.json({
        success: true,
        paymentUrl: paymentUrl,
        planId: tilopayPlanId,
        message: 'Plan created successfully. Redirect user to complete payment.'
      });
    } else {
      // Unexpected response format
      console.error('❌ Unexpected plan response format');
      return NextResponse.json({
        error: 'Plan created but unexpected response format'
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('❌ [create-plan-repeat] Error:', error?.name || 'unknown_error');
    return NextResponse.json({
      error: 'Failed to create subscription plan'
    }, { status: 500 });
  }
}
