import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Generate Tilopay SDK Token
 * Based on official Tilopay documentation
 * Endpoint: POST /api/tilopay/get-sdk-token
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔐 Generating Tilopay SDK token...');
    
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', token.email);

    const { planId, amount } = await request.json();
    
    const apiUser = process.env.TILOPAY_API_USER || process.env.TILOPAY_USER || '';
    const apiPassword = process.env.TILOPAY_API_PASSWORD || process.env.TILOPAY_PASSWORD || '';
    const apiKey = process.env.TILOPAY_API_KEY || '';
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      console.error('❌ Missing Tilopay credentials');
      return NextResponse.json({ 
        error: 'Tilopay not configured',
        details: 'Missing API credentials. Check TILOPAY_API_USER, TILOPAY_API_PASSWORD, and TILOPAY_API_KEY'
      }, { status: 500 });
    }

    console.log('📦 API User:', apiUser);
    console.log('📦 Base URL:', baseUrl);

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

    console.log('📤 Requesting SDK token from Tilopay...');
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));

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

    console.log('📥 Tilopay response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Tilopay SDK token error:', errorText);
      return NextResponse.json({ 
        error: 'Failed to generate payment token',
        details: errorText,
        status: response.status
      }, { status: 500 });
    }

    const data = await response.json();
    console.log('✅ SDK token generated successfully');
    console.log('📦 Response:', JSON.stringify(data, null, 2));
    
    return NextResponse.json({ 
      status: 'success',
      token: data.token,
      methods: data.methods || [],
      cards: data.cards || [],
      environment: data.environment || 'TEST'
    });

  } catch (error: any) {
    console.error('❌ Error generating SDK token:', error);
    return NextResponse.json({ 
      error: 'Failed to generate payment token',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

