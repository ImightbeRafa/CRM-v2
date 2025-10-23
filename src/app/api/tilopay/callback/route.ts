import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Tilopay Payment Callback Handler
 * Receives payment confirmation from Tilopay SDK redirect
 * Endpoint: POST /api/tilopay/callback
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 Tilopay callback received');
    
    // Tilopay sends data as form-encoded or JSON
    const contentType = request.headers.get('content-type');
    let data: any;
    
    if (contentType?.includes('application/json')) {
      data = await request.json();
    } else {
      // Parse form data
      const formData = await request.formData();
      data = Object.fromEntries(formData);
    }
    
    console.log('📦 Callback data:', JSON.stringify(data, null, 2));

    // Extract transaction details
    const { 
      message, 
      transactionId, 
      status, 
      cardToken,
      orderNumber,
      amount,
      currency
    } = data;

    if (message === 'Success' && (status === 'Approved' || status === 'approved')) {
      console.log('✅ Payment approved');
      
      // Parse orderNumber to get tenant and plan
      // Format: {tenantId}-{planId}-{timestamp}
      const parts = orderNumber?.split('-');
      
      if (parts && parts.length >= 2) {
        const tenantId = parts[0];
        const planName = parts[1];
        
        console.log(`📦 Tenant: ${tenantId}, Plan: ${planName}`);
        
        try {
          // Update tenant plan
          await prisma.tenant.update({
            where: { id: tenantId },
            data: {
              plan: planName.toUpperCase(),
              subscriptionStatus: 'active',
              stripeSubscriptionId: cardToken || transactionId, // Store for recurring
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
              cancelAtPeriodEnd: false
            }
          });

          console.log(`✅ Plan upgraded: ${tenantId} -> ${planName.toUpperCase()}`);
          
          // Log transaction
          console.log('💳 Transaction ID:', transactionId);
          console.log('💰 Amount:', amount, currency);
          if (cardToken) {
            console.log('🎫 Card token saved for recurring:', cardToken);
          }
          
        } catch (dbError) {
          console.error('❌ Database update failed:', dbError);
          // Continue to redirect even if DB update fails
        }
      }

      // Redirect to success page
      const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&success=true`;
      console.log('🔀 Redirecting to:', redirectUrl);
      return NextResponse.redirect(redirectUrl);
      
    } else {
      console.error('❌ Payment failed or declined');
      console.log('Status:', status);
      console.log('Message:', message);
      
      const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&error=payment_failed`;
      return NextResponse.redirect(redirectUrl);
    }

  } catch (error: any) {
    console.error('❌ Callback processing error:', error);
    
    // Still try to redirect to show user something
    const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&error=callback_error`;
    return NextResponse.redirect(redirectUrl);
  }
}

/**
 * Handle GET requests (in case Tilopay uses GET redirect)
 */
export async function GET(request: NextRequest) {
  console.log('🔔 Tilopay callback received (GET)');
  
  const searchParams = request.nextUrl.searchParams;
  const data = Object.fromEntries(searchParams.entries());
  
  console.log('📦 Callback params:', JSON.stringify(data, null, 2));
  
  // Process same as POST
  return POST(request);
}

