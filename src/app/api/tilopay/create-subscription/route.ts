import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

/**
 * Create Tilopay Subscription
 * 
 * This processes the tokenized payment and creates a recurring subscription
 * The token contains encrypted card data from the frontend SDK
 * 
 * Endpoint: POST /api/tilopay/create-subscription
 */
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token || !token.sub) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { planId, token: paymentToken, amount } = await request.json();

    if (!planId || !paymentToken || !amount) {
      return NextResponse.json({ 
        error: 'Missing required fields: planId, token, amount' 
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
          select: {
            tenantId: true,
            tenant: {
              select: {
                id: true,
                name: true,
                plan: true,
                tilopayCustomerId: true
              }
            }
          }
        }
      }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'No active tenant found' }, { status: 404 });
    }

    const membership = user.memberships[0];
    const tenantId = membership.tenantId;
    const tenant = membership.tenant;

    // Tilopay API credentials
    const apiUser = process.env.TILOPAY_USER || '';
    const apiPassword = process.env.TILOPAY_PASSWORD || '';
    const apiKey = process.env.TILOPAY_API_KEY || '';
    const baseUrl = process.env.TILOPAY_BASE_URL || 'https://api.tilopay.com/v1';

    if (!apiUser || !apiPassword || !apiKey) {
      return NextResponse.json({ 
        error: 'Payment system not configured' 
      }, { status: 500 });
    }

    const auth = Buffer.from(`${apiUser}:${apiPassword}`).toString('base64');

    console.log('💳 Processing subscription payment...', { tenantId, planId, amount });

    // **Step 1: Process the payment (charge the card)**
    const orderReference = `${tenantId}-${planId}-${Date.now()}`;
    
    const paymentPayload = {
      token: paymentToken,
      orderNumber: orderReference,
      amount,
      currency: 'CRC',
      capture: 1, // Immediate capture
      subscription: 1, // Save for recurring
      description: `Suscripción ${planId.toUpperCase()} - ${tenant.name}`
    };

    const paymentResponse = await fetch(`${baseUrl}/processPayment`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(paymentPayload)
    });

    if (!paymentResponse.ok) {
      const errorText = await paymentResponse.text();
      console.error('❌ Payment processing error:', paymentResponse.status, errorText);
      return NextResponse.json({ 
        error: 'Payment processing failed'
      }, { status: 500 });
    }

    const paymentResult = await paymentResponse.json();

    console.log('📦 Payment result:', paymentResult);

    // Check if payment requires 3DS
    if (paymentResult.requires3DS || paymentResult.redirectUrl) {
      return NextResponse.json({
        success: true,
        requires3DS: true,
        redirectUrl: paymentResult.redirectUrl
      });
    }

    // Check payment status
    const paymentStatus = (paymentResult.status || paymentResult.estado || '').toLowerCase();
    const isSuccess = ['approved', 'aprobada', 'success', 'paid'].includes(paymentStatus);

    if (!isSuccess) {
      console.error('❌ Payment declined:', paymentResult);
      return NextResponse.json({ 
        error: 'Payment declined',
        reason: paymentResult.reason || paymentResult.message || 'Unknown reason'
      }, { status: 400 });
    }

    // **Step 2: Save subscription info in database**
    const now = new Date();
    const nextBillingDate = new Date(now);
    nextBillingDate.setDate(nextBillingDate.getDate() + 30); // Monthly billing

    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        plan: planId.toUpperCase() as any,
        subscriptionStatus: 'active',
        tilopaySubscriptionId: paymentResult.subscriptionId || orderReference,
        tilopayCustomerId: paymentResult.customerId || tenant.tilopayCustomerId,
        currentPeriodStart: now,
        currentPeriodEnd: nextBillingDate,
        cancelAtPeriodEnd: false,
        trialEndsAt: null
      }
    });

    // **Step 3: Create billing transaction record**
    await prisma.billingTransaction.create({
      data: {
        tenantId,
        amount,
        currency: 'CRC',
        status: 'success',
        description: `Suscripción ${planId.toUpperCase()} - Pago inicial [${orderReference}]`,
        paymentMethod: 'tilopay',
        periodStart: now,
        periodEnd: nextBillingDate
      }
    });

    // **Step 4: Create audit log**
    await prisma.auditLog.create({
      data: {
        tenantId,
        userId: user.id,
        userName: user.email || 'Unknown',
        userRole: 'OWNER',
        action: 'UPDATE',
        entityType: 'subscription',
        entityId: orderReference,
        entityName: `Suscripción ${planId.toUpperCase()}`,
        oldValues: { plan: tenant.plan, status: 'previous' },
        newValues: {
          plan: planId.toUpperCase(),
          status: 'active',
          subscriptionId: paymentResult.subscriptionId,
          nextBilling: nextBillingDate.toISOString()
        }
      }
    });

    console.log('✅ Subscription created successfully');

    return NextResponse.json({
      success: true,
      subscriptionId: paymentResult.subscriptionId || orderReference,
      plan: planId.toUpperCase(),
      status: 'active',
      nextBillingDate: nextBillingDate.toISOString()
    });

  } catch (error: any) {
    console.error('❌ Error creating subscription:', error);
    return NextResponse.json({
      error: 'Failed to create subscription'
    }, { status: 500 });
  }
}
