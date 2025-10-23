import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Create Tilopay Payment Link (Direct REST API)
 * Alternative to SDK token generation
 * Endpoint: POST /api/tilopay/create-payment-link
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔐 Creating Tilopay payment link (Direct API)...');
    
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token || !token.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('✅ User authenticated:', token.email);

    const { planId, amount } = await request.json();
    
    const apiKey = process.env.TILOPAY_API_KEY || '';
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://app.tilopay.com/api/v1';

    if (!apiKey) {
      console.error('❌ Missing Tilopay API key');
      return NextResponse.json({ 
        error: 'Tilopay not configured',
        details: 'Missing TILOPAY_API_KEY'
      }, { status: 500 });
    }

    const orderNumber = `${token.tenantId}-${planId}-${Date.now()}`;
    
    // Try different possible endpoints
    const endpoints = ['/captures', '/transactions', '/payment-links', '/create-payment'];
    let successfulResponse = null;

    for (const endpoint of endpoints) {
      try {
        console.log(`📤 Trying endpoint: ${endpoint}`);
        
        const payload = {
          key: apiKey,
          amount: amount,
          currency: 'CRC',
          description: `Plan ${planId.toUpperCase()} - Betsy CRM`,
          order_id: orderNumber,
          redirect_success: `${process.env.NEXTAUTH_URL}/config?tab=billing&success=true`,
          redirect_error: `${process.env.NEXTAUTH_URL}/config?tab=billing&error=payment_failed`,
          notification_url: `${process.env.NEXTAUTH_URL}/api/tilopay/webhook`,
          email: token.email as string
        };

        console.log('📦 Payload:', JSON.stringify(payload, null, 2));

        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'key': apiKey,
            'X-API-KEY': apiKey
          },
          body: JSON.stringify(payload)
        });

        console.log(`📥 Response status: ${response.status}`);

        if (response.ok) {
          const data = await response.json();
          console.log('✅ Success with endpoint:', endpoint);
          console.log('📦 Response data:', JSON.stringify(data, null, 2));
          
          successfulResponse = {
            endpoint,
            data,
            paymentUrl: data.payment_url || data.url || data.link || data.checkout_url
          };
          break;
        } else {
          const errorText = await response.text();
          console.log(`❌ Failed with ${endpoint}:`, errorText);
        }
      } catch (endpointError: any) {
        console.log(`❌ Error with ${endpoint}:`, endpointError.message);
      }
    }

    if (successfulResponse && successfulResponse.paymentUrl) {
      console.log('✅ Payment link created:', successfulResponse.paymentUrl);
      
      return NextResponse.json({ 
        status: 'success',
        paymentUrl: successfulResponse.paymentUrl,
        endpoint: successfulResponse.endpoint,
        orderNumber
      });
    } else {
      console.error('❌ All endpoints failed');
      
      // Return detailed error for debugging
      return NextResponse.json({ 
        error: 'Could not create payment link',
        details: 'All Tilopay endpoints returned errors',
        triedEndpoints: endpoints,
        suggestion: 'Contact Tilopay support for correct endpoint documentation'
      }, { status: 500 });
    }

  } catch (error: any) {
    console.error('❌ Error creating payment link:', error);
    return NextResponse.json({ 
      error: 'Failed to create payment link',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

