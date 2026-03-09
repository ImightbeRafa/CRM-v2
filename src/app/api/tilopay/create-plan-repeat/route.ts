import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

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

    console.log('✅ [create-plan-repeat] User authenticated:', token.sub);

    const body = await request.json();
    console.log('📦 [create-plan-repeat] Request body:', body);
    
    const { planId, planName = 'Básico', amount, currency = 'CRC' } = body;

    if (!planId || !amount) {
      return NextResponse.json({ 
        error: 'Missing required fields: planId, amount' 
      }, { status: 400 });
    }

    // Get user with tenant info
    const { prisma } = await import('@/lib/db');
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          where: { isActive: true },
          take: 1,
          select: { tenantId: true }
        }
      }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const tenantId = user.memberships[0].tenantId;

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
      const loginError = await loginResponse.text();
      console.error('❌ Tilopay login failed:', loginResponse.status, loginError);
      return NextResponse.json({ 
        error: 'Failed to authenticate with payment provider',
        details: loginError,
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
      const planError = await planResponse.text();
      console.error('❌ Plan creation failed:', planResponse.status, planError);
      return NextResponse.json({ 
        error: 'Failed to create subscription plan'
      }, { status: 500 });
    }

    const planData = await planResponse.json();
    console.log('✅ Plan created:', JSON.stringify(planData, null, 2));

    // Expected response: { type: '200', id: 624, url: 'https://app.tilopay.com/link/TmpJMHwx' }
    if (planData.type === '200' && planData.url) {
      const paymentUrl = planData.url;
      const tilopayPlanId = planData.id;
      
      console.log('🔗 Hosted payment URL:', paymentUrl);
      console.log('🆔 Tilopay plan ID:', tilopayPlanId);
      
      // Store Tilopay plan ID in tenant so webhooks can find it
      try {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            tilopaySubscriptionId: String(tilopayPlanId)
          }
        });
        console.log('✅ Tilopay plan ID stored in tenant for webhook matching');
      } catch (dbError) {
        console.warn('⚠️ Failed to store plan ID:', dbError);
      }
      
      return NextResponse.json({
        success: true,
        paymentUrl: paymentUrl,
        planId: tilopayPlanId,
        message: 'Plan created successfully. Redirect user to complete payment.'
      });
    } else {
      // Unexpected response format
      console.error('❌ Unexpected plan response format:', planData);
      return NextResponse.json({
        error: 'Plan created but unexpected response format'
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('❌ [create-plan-repeat] Error:', error);
    console.error('❌ [create-plan-repeat] Error message:', error.message);
    console.error('❌ [create-plan-repeat] Error stack:', error.stack);
    return NextResponse.json({
      error: 'Failed to create subscription plan'
    }, { status: 500 });
  }
}
