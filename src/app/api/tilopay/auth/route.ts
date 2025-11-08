import { NextResponse } from 'next/server';

/**
 * Tilopay Authentication Helper
 * 
 * Obtains bearer token from /loginSdk for API calls
 * Token is valid for 24 hours (86400 seconds)
 * 
 * Endpoint: POST /api/tilopay/auth
 */
export async function POST() {
  try {
    console.log('🔐 [tilopay-auth] Obtaining bearer token...');

    const apiUser = process.env.TILOPAY_USER;
    const apiPassword = process.env.TILOPAY_PASSWORD;
    const apiKey = process.env.TILOPAY_API_KEY;
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      console.error('❌ Missing Tilopay credentials');
      return NextResponse.json({ 
        error: 'Payment system not configured' 
      }, { status: 500 });
    }

    // Use /login endpoint (not /loginSdk) as per Tilopay docs
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiuser: apiUser,
        password: apiPassword
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Tilopay auth failed:', response.status, errorText);
      return NextResponse.json({ 
        error: 'Authentication failed',
        details: errorText
      }, { status: 500 });
    }

    const data = await response.json();
    const { access_token, expires_in } = data;

    if (!access_token) {
      console.error('❌ No access token in response');
      return NextResponse.json({ 
        error: 'Invalid authentication response' 
      }, { status: 500 });
    }

    console.log('✅ Bearer token obtained, expires in:', expires_in);
    
    // TODO: Cache token in Redis/memory until expiry (24h)
    return NextResponse.json({ 
      token: access_token,
      expiresIn: expires_in 
    });

  } catch (error: any) {
    console.error('❌ [tilopay-auth] Error:', error);
    return NextResponse.json({ 
      error: 'Auth error',
      message: error.message 
    }, { status: 500 });
  }
}
