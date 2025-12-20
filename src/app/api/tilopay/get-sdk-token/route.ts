import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Generate Tilopay SDK Token
 * Based on official Tilopay documentation
 * Endpoint: POST /api/tilopay/get-sdk-token
 */
export async function POST(request: NextRequest) {
  try {
    if (isDev) console.log('🔐 Generating Tilopay SDK token...');
    
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user with memberships to find tenant ID
    const { prisma } = await import('@/lib/db');
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // Don't log email in production
    if (isDev) console.log('✅ User authenticated:', user.email?.substring(0, 3) + '***');

    const { planId, amount } = await request.json();
    
    const apiUser = process.env.TILOPAY_API_USER || process.env.TILOPAY_USER || '';
    const apiPassword = process.env.TILOPAY_API_PASSWORD || process.env.TILOPAY_PASSWORD || '';
    const apiKey = process.env.TILOPAY_API_KEY || '';
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://api.tilopay.com/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      console.error('❌ Missing Tilopay credentials');
      return NextResponse.json({ 
        error: 'Tilopay not configured',
        details: 'Missing API credentials'
      }, { status: 500 });
    }

    if (isDev) {
      console.log('📦 API User:', apiUser);
      console.log('📦 Base URL:', baseUrl);
    }

    // Create Basic Auth header
    const auth = Buffer.from(`${apiUser}:${apiPassword}`).toString('base64');

    const orderNumber = `${token.tenantId}-${planId}-${Date.now()}`;
    
    const payload = {
      currency: 'CRC', // Costa Rican Colones
      amount: amount || 45000,
      orderNumber: orderNumber,
      billToEmail: token.email as string,
      subscription: 1, // Save card for recurring payments
      capture: 1, // Capture immediately
      redirect: `${process.env.NEXTAUTH_URL}/api/tilopay/callback`,
      billToFirstName: token.name?.split(' ')[0] || 'User',
      billToLastName: token.name?.split(' ').slice(1).join(' ') || 'Customer'
    };

    if (isDev) {
      console.log('📤 Requesting SDK token from Tilopay...');
      // Don't log full payload - contains email
      console.log('📦 Payload keys:', Object.keys(payload));
    }

    const response = await fetch(`${baseUrl}/getTokenSdk`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'X-API-KEY': apiKey,
        'key': apiKey, // Some versions use 'key' header
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (isDev) console.log('📥 Tilopay response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Tilopay SDK token error');
      return NextResponse.json({ 
        error: 'Failed to generate payment token',
        status: response.status
      }, { status: 500 });
    }

    const data = await response.json();
    if (isDev) {
      console.log('✅ SDK token generated successfully');
      // Don't log token value
      console.log('📦 Response keys:', Object.keys(data));
    }
    
    return NextResponse.json({ 
      status: 'success',
      token: data.token,
      methods: data.methods || [],
      cards: data.cards || [],
      environment: data.environment || 'TEST'
    });

  } catch (error: any) {
    console.error('❌ Error generating SDK token:', error.message);
    return NextResponse.json({ 
      error: 'Failed to generate payment token',
      // Don't expose error message or stack in production
      ...(isDev && { message: error.message })
    }, { status: 500 });
  }
}
