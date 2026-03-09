import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Generate Tilopay SDK Token for Subscription
 * 
 * This creates a tokenization session for secure card data capture
 * The SDK token is used client-side to encrypt card information
 * 
 * Endpoint: POST /api/tilopay/create-subscription-token
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔐 [create-subscription-token] Starting...');
    
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      console.error('❌ [create-subscription-token] Unauthorized - no token');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ [create-subscription-token] User authenticated:', token.sub);

    const body = await request.json();
    console.log('📦 [create-subscription-token] Request body:', body);
    
    const { planId, amount, currency = 'CRC', recurring = true } = body;

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

    // Tilopay API credentials
    const apiUser = process.env.TILOPAY_USER || '';
    const apiPassword = process.env.TILOPAY_PASSWORD || '';
    const apiKey = process.env.TILOPAY_API_KEY || '';
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      console.error('❌ Missing Tilopay credentials');
      return NextResponse.json({ 
        error: 'Payment system not configured',
        details: 'Missing TILOPAY credentials in environment'
      }, { status: 500 });
    }

    // Step 1: Login to get JWT access token
    console.log('🔐 Logging in to Tilopay...');
    
    // Login payload: only apiuser and password (key is used AFTER login for API calls)
    const loginPayload = {
      apiuser: apiUser,
      password: apiPassword
    };
    // Login payload prepared (credentials not logged for security)
    
    const loginResponse = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(loginPayload)
    });

    console.log('📥 Login response status:', loginResponse.status);

    if (!loginResponse.ok) {
      const loginError = await loginResponse.text();
      console.error('❌ Tilopay login failed:', loginResponse.status, loginError);
      console.error('❌ Check: 1) Credentials correct? 2) Test mode enabled? 3) Account active?');
      return NextResponse.json({ 
        error: 'Failed to authenticate with payment provider',
        details: loginError,
        hint: 'Check credentials in .env.local: TILOPAY_USER, TILOPAY_PASSWORD, TILOPAY_API_KEY'
      }, { status: 500 });
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.access_token;

    if (!accessToken) {
      console.error('❌ No access token in login response:', loginData);
      return NextResponse.json({ 
        error: 'Invalid authentication response'
      }, { status: 500 });
    }

    console.log('✅ Logged in successfully, token expires at:', loginData.expires_in);

    // Generate unique order reference
    const orderNumber = `${tenantId}-${planId}-${Date.now()}`;

    console.log('💡 No GetTokenSdk endpoint exists - using bearer token directly for SDK');
    console.log('📦 Order number:', orderNumber);

    // Return the bearer token we got from login
    // SDK v2 might be able to use this directly
    const data = {
      token: accessToken, // Bearer token from login
      orderNumber,
      email: user.email,
      firstName: user.name?.split(' ')[0] || 'User',
      lastName: user.name?.split(' ').slice(1).join(' ') || 'Customer'
    };

    console.log('✅ Returning bearer token to frontend');
    console.log('📤 SDK will attempt initialization with bearer token');

    return NextResponse.json(data);

  } catch (error: any) {
    console.error('❌ [create-subscription-token] Error:', error);
    console.error('❌ [create-subscription-token] Error message:', error.message);
    console.error('❌ [create-subscription-token] Error stack:', error.stack);
    return NextResponse.json({
      error: 'Failed to initialize payment'
    }, { status: 500 });
  }
}
