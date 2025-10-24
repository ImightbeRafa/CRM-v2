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

    // Tilopay Repeat sends different formats:
    // Format 1 (actual): { id_plan, email, amount, auth, orderNumber, paymentId }
    // Format 2 (future): { event, data: { ... } }
    
    let subscriberEmail: string | null = null;
    let amount = 0;
    let planId = null;
    let paymentId = null;
    let orderNumber = null;
    let event = 'payment_success'; // Default for Tilopay Repeat

    // Detect format and extract data
    if (payload.email && payload.id_plan) {
      // Format 1: Direct Tilopay Repeat format
      subscriberEmail = payload.email;
      amount = parseFloat(payload.amount || 0);
      planId = payload.id_plan;
      paymentId = payload.paymentId;
      orderNumber = payload.orderNumber;
      
      console.log('📋 Detected Tilopay Repeat format');
      console.log(`   Plan ID: ${planId}`);
      console.log(`   Amount: ${amount}`);
      console.log(`   Payment ID: ${paymentId}`);
    } else if (payload.event && payload.data) {
      // Format 2: Structured event format
      subscriberEmail = payload.data.email || payload.data.subscriber_email || payload.data.billToEmail;
      amount = parseFloat(payload.data.amount || 0);
      event = payload.event;
      paymentId = payload.data.paymentId || payload.data.payment_id;
      
      console.log('📋 Detected structured event format');
      console.log(`   Event: ${event}`);
    } else {
      console.error('❌ Unknown webhook format:', payload);
      return NextResponse.json({ error: 'Unknown payload format' }, { status: 400 });
    }
    
    if (!subscriberEmail) {
      console.error('❌ No subscriber email in webhook');
      return NextResponse.json({ error: 'No subscriber email' }, { status: 400 });
    }

    console.log(`👤 Looking for user: ${subscriberEmail}`);

    // Find user and their tenant through memberships
    const user = await prisma.user.findUnique({
      where: { email: subscriberEmail },
      select: { 
        id: true,
        email: true,
        defaultTenantId: true,
        memberships: {
          where: {
            isActive: true
          },
          select: {
            tenantId: true,
            role: true,
            tenant: {
              select: {
                id: true,
                name: true,
                plan: true
              }
            }
          }
        }
      }
    });

    if (!user) {
      console.error(`❌ User not found: ${subscriberEmail}`);
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Get the user's tenant (prefer default, fallback to first membership)
    const membership = user.memberships.find(m => m.tenantId === user.defaultTenantId) || user.memberships[0];
    
    if (!membership) {
      console.error(`❌ No active tenant membership for user: ${subscriberEmail}`);
      return NextResponse.json({ error: 'User has no active tenant' }, { status: 404 });
    }

    const tenantId = membership.tenantId;
    const tenant = membership.tenant;

    console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenantId})`);

    // Determine plan from amount (in USD)
    // BASIC Plan: $15 USD/month (₡15,000 CRC)
    // PRO Plan: $45 USD/month (₡45,000 CRC)
    let newPlan = 'FREE';
    
    if (amount >= 40) {
      // $40+ USD = PRO Plan
      newPlan = 'PRO';
      console.log(`📋 Detected plan: PRO (amount: $${amount} USD)`);
    } else if (amount >= 10) {
      // $10+ USD = BASIC Plan
      newPlan = 'BASIC';
      console.log(`📋 Detected plan: BASIC (amount: $${amount} USD)`);
    } else {
      // Less than $10 = Keep FREE or log warning
      console.log(`⚠️ Amount too low: $${amount} USD - keeping current plan or FREE`);
      newPlan = tenant.plan || 'FREE';
    }

    // For Tilopay Repeat with paymentId, it's a successful payment
    if (paymentId) {
      console.log('✅ Payment successful - checking for duplicates...');
      
      // Check for duplicate transaction (idempotency)
      const existingTransaction = await prisma.billingTransaction.findFirst({
        where: {
          tenantId: tenantId,
          OR: [
            { description: { contains: orderNumber || '' } },
            { description: { contains: paymentId?.toString() || '' } }
          ]
        }
      });

      if (existingTransaction) {
        console.log(`⚠️ Duplicate webhook detected - transaction already processed: ${orderNumber || paymentId}`);
        return NextResponse.json({ 
          status: 'success',
          message: 'Duplicate webhook - already processed',
          alreadyProcessed: true,
          transactionId: existingTransaction.id
        });
      }

      console.log('✅ No duplicate found - processing payment');
      console.log(`🔄 Updating tenant ${tenantId} from plan "${tenant.plan}" to "${newPlan}"`);
      
      // Calculate next billing date (30 days from now for monthly subscriptions)
      const now = new Date();
      const nextBillingDate = new Date(now);
      nextBillingDate.setDate(nextBillingDate.getDate() + 30); // Monthly subscription
      
      const updatedTenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: newPlan as any, // Cast to any to ensure it's accepted
          subscriptionStatus: 'active',
          tilopaySubscriptionId: orderNumber || paymentId?.toString(),
          currentPeriodStart: now,
          currentPeriodEnd: nextBillingDate,
          trialEndsAt: null // Clear trial end date
        }
      });

      console.log(`✅ Updated tenant ${tenantId} to ${newPlan} (active)`);
      console.log(`✅ Verified: Tenant plan is now "${updatedTenant.plan}"`);
      console.log(`📅 Next billing date: ${nextBillingDate.toISOString()}`);
      
      // Create billing transaction record
      try {
        const planPrices: Record<string, number> = {
          'BASIC': 15000,  // ₡15,000
          'PRO': 45000     // ₡45,000
        };

        const transactionAmount = planPrices[newPlan] || amount * 1000; // Convert to colones if in dollars

        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount: transactionAmount,
            currency: 'CRC',
            status: 'success',
            description: `Suscripción ${newPlan} - Pago mensual`,
            paymentMethod: 'tilopay',
            periodStart: now,
            periodEnd: nextBillingDate
          }
        });

        console.log(`💳 Created billing transaction: ₡${transactionAmount} CRC`);
      } catch (transactionError) {
        console.error('⚠️ Failed to create billing transaction:', transactionError);
        // Don't fail the webhook if transaction logging fails
      }
      
      // Log the webhook event
      try {
        await prisma.auditLog.create({
          data: {
            tenantId: tenantId,
            userId: user.id,
            userName: user.email || subscriberEmail,
            userRole: membership.role,
            action: 'UPDATE', // Subscription plan updated
            entityType: 'subscription',
            entityId: orderNumber || paymentId?.toString() || 'unknown',
            entityName: `${newPlan} Plan`,
            oldValues: {
              plan: tenant.plan,
              status: 'trial_or_previous'
            },
            newValues: {
              ...payload,
              webhookEvent: 'tilopay_payment_success',
              plan: newPlan,
              status: 'active'
            }
          }
        });
        console.log('✅ Audit log created');
      } catch (auditError) {
        console.error('⚠️ Failed to log audit:', auditError);
      }

      return NextResponse.json({ 
        status: 'success',
        message: 'Payment processed and plan updated',
        tenantId: tenantId,
        newPlan,
        paymentId
      });
    }

    // Handle other event types if provided
    switch (event) {
      case 'subscription.payment_failed':
      case 'payment_failed':
        console.log('⚠️ Payment failed');
        
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            subscriptionStatus: 'payment_failed'
          }
        });

        console.log(`⚠️ Marked tenant ${tenantId} as payment_failed`);
        break;

      case 'subscription.cancelled':
      case 'subscription.paused':
      case 'cancelled':
        console.log('❌ Subscription cancelled/paused');
        
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: 'FREE',
            subscriptionStatus: 'cancelled',
            tilopaySubscriptionId: null
          }
        });

        console.log(`❌ Downgraded tenant ${tenantId} to FREE (cancelled)`);
        break;

      default:
        console.log(`ℹ️ Event type: ${event}`);
    }

    // Log the webhook event
    try {
      // Map event to appropriate AuditAction
      let auditAction: any = 'UPDATE';
      if (event.includes('cancelled') || event.includes('paused')) {
        auditAction = 'DELETE';
      }
      
      await prisma.auditLog.create({
        data: {
          tenantId: tenantId,
          userId: user.id,
          userName: user.email || subscriberEmail,
          userRole: membership.role,
          action: auditAction,
          entityType: 'subscription',
          entityId: orderNumber || paymentId?.toString() || 'unknown',
          entityName: `${newPlan} Plan - ${event}`,
          oldValues: {
            plan: tenant.plan,
            status: 'previous'
          },
          newValues: {
            ...payload,
            webhookEvent: event,
            plan: newPlan
          }
        }
      });
      console.log('✅ Audit log created');
    } catch (auditError) {
      console.error('⚠️ Failed to log audit:', auditError);
    }

    return NextResponse.json({ 
      status: 'success',
      message: 'Webhook processed',
      event,
      tenantId: tenantId,
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

