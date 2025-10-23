import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Tilopay Repeat Webhook Handler
 * 
 * Handles callbacks from Tilopay Repeat subscription plans
 * Events: subscription.created, subscription.payment_success, subscription.payment_failed, subscription.cancelled
 * 
 * Endpoint: POST /api/tilopay/webhook-repeat
 * 
 * This should be configured in your Tilopay Repeat plan settings:
 * Webhook URL: https://your-domain.com/api/tilopay/webhook-repeat
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🔔 Tilopay Repeat webhook received');
    
    const payload = await request.json();
    console.log('📦 Webhook payload:', JSON.stringify(payload, null, 2));

    const { event, data } = payload;

    if (!event || !data) {
      console.error('❌ Invalid webhook payload');
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Extract subscriber email to find tenant
    const subscriberEmail = data.email || data.subscriber_email || data.billToEmail;
    
    if (!subscriberEmail) {
      console.error('❌ No subscriber email in webhook');
      return NextResponse.json({ error: 'No subscriber email' }, { status: 400 });
    }

    console.log(`👤 Looking for user: ${subscriberEmail}`);

    // Find user and their tenant
    const user = await prisma.user.findUnique({
      where: { email: subscriberEmail },
      select: { 
        id: true, 
        tenantId: true,
        tenant: {
          select: {
            id: true,
            name: true,
            plan: true
          }
        }
      }
    });

    if (!user || !user.tenantId) {
      console.error(`❌ User not found: ${subscriberEmail}`);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    console.log(`✅ Found tenant: ${user.tenant.name} (ID: ${user.tenantId})`);

    // Determine plan from webhook data
    let newPlan = 'FREE';
    const planName = (data.plan_name || data.planName || '').toLowerCase();
    const amount = parseFloat(data.amount || 0);

    if (planName.includes('pro') || amount >= 40000) {
      newPlan = 'PRO';
    } else if (planName.includes('basic') || amount >= 10000) {
      newPlan = 'BASIC';
    }

    console.log(`📋 Detected plan: ${newPlan} (from ${planName || amount})`);

    // Handle different webhook events
    switch (event) {
      case 'subscription.created':
      case 'subscription.activated':
      case 'subscription.payment_success':
        console.log('✅ Subscription activated/payment successful');
        
        await prisma.tenant.update({
          where: { id: user.tenantId },
          data: {
            plan: newPlan,
            subscriptionStatus: 'active',
            tilopaySubscriptionId: data.subscription_id || data.subscriptionId,
            trialEndsAt: null // Clear trial end date
          }
        });

        console.log(`✅ Updated tenant ${user.tenantId} to ${newPlan} (active)`);
        break;

      case 'subscription.payment_failed':
        console.log('⚠️ Payment failed');
        
        await prisma.tenant.update({
          where: { id: user.tenantId },
          data: {
            subscriptionStatus: 'payment_failed'
          }
        });

        console.log(`⚠️ Marked tenant ${user.tenantId} as payment_failed`);
        break;

      case 'subscription.cancelled':
      case 'subscription.paused':
        console.log('❌ Subscription cancelled/paused');
        
        await prisma.tenant.update({
          where: { id: user.tenantId },
          data: {
            plan: 'FREE',
            subscriptionStatus: 'cancelled',
            tilopaySubscriptionId: null
          }
        });

        console.log(`❌ Downgraded tenant ${user.tenantId} to FREE (cancelled)`);
        break;

      default:
        console.log(`ℹ️ Unhandled event: ${event}`);
    }

    // Log the webhook event in database for tracking
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          action: `tilopay_webhook_${event}`,
          resource: 'subscription',
          details: JSON.stringify(payload)
        }
      });
    } catch (auditError) {
      console.error('⚠️ Failed to log audit:', auditError);
      // Don't fail the webhook if audit logging fails
    }

    return NextResponse.json({ 
      status: 'success',
      message: 'Webhook processed',
      event,
      tenantId: user.tenantId,
      newPlan
    });

  } catch (error: any) {
    console.error('❌ Webhook error:', error);
    return NextResponse.json({ 
      error: 'Webhook processing failed',
      message: error.message,
      stack: error.stack
    }, { status: 500 });
  }
}

// Allow webhook to be called without authentication
export const dynamic = 'force-dynamic';

