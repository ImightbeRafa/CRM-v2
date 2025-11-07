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
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { planId, amount, currency = 'CRC', recurring = true } = await request.json();

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

    // Create Basic Auth header
    const auth = Buffer.from(`${apiUser}:${apiPassword}`).toString('base64');

    // Generate unique order reference
    const orderNumber = `${tenantId}-${planId}-${Date.now()}`;

    // Payload for SDK token generation
    const payload = {
      currency,
      amount,
      orderNumber,
      billToEmail: user.email,
      billToFirstName: user.name?.split(' ')[0] || 'User',
      billToLastName: user.name?.split(' ').slice(1).join(' ') || 'Customer',
      subscription: recurring ? 1 : 0, // 1 = save card for recurring
      capture: 1, // Capture payment immediately
      redirect: `${process.env.NEXTAUTH_URL}/config?tab=billing&success=true`
    };

    console.log('📤 Requesting SDK token from Tilopay...', { orderNumber, amount, currency });

    // Request SDK token from Tilopay
    const response = await fetch(`${baseUrl}/getTokenSdk`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'X-API-KEY': apiKey,
        'key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Tilopay token error:', response.status, errorText);
      return NextResponse.json({ 
        error: 'Failed to generate payment token',
        details: errorText,
        status: response.status
      }, { status: 500 });
    }

    const data = await response.json();

    if (!data.token) {
      console.error('❌ No token in Tilopay response:', data);
      return NextResponse.json({ 
        error: 'Invalid response from payment provider' 
      }, { status: 500 });
    }

    console.log('✅ SDK token generated successfully');

    return NextResponse.json({
      success: true,
      token: data.token,
      orderNumber,
      environment: data.environment || (process.env.NODE_ENV === 'production' ? 'production' : 'test')
    });

  } catch (error: any) {
    console.error('❌ Error generating SDK token:', error);
    return NextResponse.json({
      error: 'Failed to initialize payment',
      message: error.message
    }, { status: 500 });
  }
}
