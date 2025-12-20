import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyWebhookSharedSecret } from '@/lib/tilopay';

// Force dynamic rendering for webhooks
export const dynamic = 'force-dynamic';

// Enhanced logging utility for webhook troubleshooting
function logWebhookEvent(level: 'info' | 'warn' | 'error', message: string, data?: any, tenantId?: string) {
  const timestamp = new Date().toISOString();
  
  // Only log errors and warnings to console (not info)
  if (level === 'error' || level === 'warn') {
    console.log(`[${timestamp}] [${level.toUpperCase()}] [Tilopay Webhook] ${message}`);
  }
  
  // Store errors and warnings in database for troubleshooting
  if (level === 'error' || level === 'warn') {
    if (tenantId && tenantId !== 'unknown') {
      prisma.webhookLog.create({
        data: {
          tenantId: tenantId,
          level,
          message,
          data: data ? JSON.stringify(data) : null,
          source: 'tilopay-webhook'
        }
      }).catch(err => console.error('Failed to store webhook log:', err));
    }
  }
}

/**
 * Handler for Tilopay Repeat API webhooks
 * Triggered by /createPlanRepeat endpoints: webhook_subscribe, webhook_payment, webhook_rejected, webhook_unsubscribe, webhook_reactive
 * 
 * Payload structure varies by event:
 * - webhook_subscribe: { id_plan, id_suscriptor, next_payment_date, email, ... }
 * - webhook_payment: { id_plan, amount, auth, ... }
 * - webhook_rejected: { id_plan, amount, reason, ... }
 * - webhook_unsubscribe: { id_plan, expire, ... }
 * - webhook_reactive: { id_plan, next_payment_date, ... }
 */
async function handleRepeatAPIWebhook(body: any, webhookId: string, startTime: number) {
  try {
    const tilopayPlanId = String(body.id_plan);
    const suscriptorId = body.id_suscriptor;
    const email = body.email;
    const amount = body.amount;
    const nextPaymentDate = body.next_payment_date;
    const expireDate = body.expire;
    const auth = body.auth;  // Authorization code for payments

    // Don't log full email or auth codes
    console.log('📊 [Repeat API] Webhook data:', { 
      tilopayPlanId, 
      suscriptorId, 
      emailPrefix: email?.substring(0, 3) + '***',
      amount, 
      nextPaymentDate, 
      expireDate,
      hasAuth: !!auth
    });

    // Determine event type from payload structure
    let eventType = 'unknown';
    if (nextPaymentDate && auth && !suscriptorId) {
      // First payment with next_payment_date = subscription activation
      eventType = 'subscribe';
    } else if (suscriptorId && nextPaymentDate && !auth) {
      eventType = 'subscribe';  // Initial subscription
    } else if (auth && amount) {
      eventType = 'payment';  // Recurring payment success
    } else if (expireDate) {
      eventType = 'unsubscribe';  // Cancellation
    } else if (nextPaymentDate && !suscriptorId) {
      eventType = 'reactive';  // Reactivation
    } else if (body.reason || body.error) {
      eventType = 'rejected';  // Payment failed
    }

    console.log(`🎯 [Repeat API] Detected event type: ${eventType}`);

    // Find tenant by tilopaySubscriptionId (we store the plan ID there)
    const tenant = await prisma.tenant.findFirst({
      where: {
        OR: [
          { tilopaySubscriptionId: tilopayPlanId },
          { tilopaySubscriptionId: suscriptorId }
        ]
      }
    });

    if (!tenant) {
      console.warn(`⚠️ [Repeat API] No tenant found for Tilopay plan ${tilopayPlanId}`);
      // Try to find by email as fallback
      if (email) {
        const user = await prisma.user.findUnique({
          where: { email },
          include: { 
            memberships: { 
              where: { isActive: true },
              take: 1,
              include: { tenant: true }
            }
          }
        });
        
        if (user?.memberships[0]?.tenant) {
          const foundTenant = user.memberships[0].tenant;
          console.log(`✅ [Repeat API] Found tenant by email: ${foundTenant.id}`);
          return await processRepeatEvent(eventType, foundTenant.id, body, webhookId, startTime);
        }
      }
      
      return NextResponse.json({
        ok: true,
        eventType,
        webhookId,
        message: 'Tenant not found - webhook logged but no DB update',
        processingTime: `${Date.now() - startTime}ms`
      });
    }

    console.log(`✅ [Repeat API] Found tenant: ${tenant.id}`);
    return await processRepeatEvent(eventType, tenant.id, body, webhookId, startTime);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('❌ [Repeat API] Webhook error:', error);
    return NextResponse.json({
      error: error.message,
      webhookId,
      processingTime: `${processingTime}ms`
    }, { status: 500 });
  }
}

async function processRepeatEvent(eventType: string, tenantId: string, body: any, webhookId: string, startTime: number) {
  const tilopayPlanId = String(body.id_plan);
  const suscriptorId = body.id_suscriptor;
  const amount = body.amount ? parseFloat(body.amount) : 0;  // Convert string to Float
  const nextPaymentDate = body.next_payment_date;
  const expireDate = body.expire;
  const auth = body.auth;

  switch (eventType) {
    case 'subscribe':
      console.log('✅ [Repeat API] Processing subscription:', { tenantId, suscriptorId });
      
      // Calculate billing period (30 days from now or from next_payment_date)
      const now = new Date();
      const periodEnd = nextPaymentDate ? new Date(nextPaymentDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: 'BASIC',  // You can map this based on amount or pass from frontend
          subscriptionStatus: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          tilopaySubscriptionId: suscriptorId || tilopayPlanId
        }
      });

      // Log initial payment transaction if auth code present
      if (auth && amount > 0) {
        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount: amount,
            currency: 'CRC',
            status: 'success',
            description: `Pago inicial suscripción BASIC [Auth: ${auth}]`,
            paymentMethod: 'tilopay-repeat',
            periodStart: now,
            periodEnd: periodEnd
          }
        });
        console.log(`💰 [Repeat API] Initial payment logged: ₡${amount}`);
      }

      console.log(`✅ [Repeat API] Tenant ${tenantId} activated with BASIC plan until ${periodEnd.toISOString()}`);
      break;

    case 'payment':
      console.log('💰 [Repeat API] Processing recurring payment:', { tenantId, amount, auth });
      
      // Extend subscription period by 30 days
      const currentTenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { currentPeriodEnd: true }
      });

      const newPeriodStart = new Date();
      const newPeriodEnd = new Date(newPeriodStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'active',
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
          cancelAtPeriodEnd: false
        }
      });

      // Log the transaction
      await prisma.billingTransaction.create({
        data: {
          tenantId: tenantId,
          amount: amount,  // Already converted to Float above
          currency: 'CRC',
          status: 'success',
          description: `Renovación mensual [Auth: ${auth}]`,
          paymentMethod: 'tilopay-repeat',
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd
        }
      });

      console.log(`✅ [Repeat API] Tenant ${tenantId} renewed until ${newPeriodEnd.toISOString()}`);
      break;

    case 'rejected':
      console.log('❌ [Repeat API] Processing payment failure:', { tenantId, reason: body.reason });
      
      // IMPORTANT: Never delete data on payment failure!
      // Set 7-day grace period before restricting access
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 7);

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'payment_failed',
          currentPeriodEnd: gracePeriodEnd  // 7-day grace period
        }
      });

      console.log(`⚠️ [Repeat API] Tenant ${tenantId} marked as payment_failed with grace period until ${gracePeriodEnd.toISOString()}`);
      console.log(`📧 TODO: Send email notification to tenant about failed payment`);
      break;

    case 'unsubscribe':
      console.log('🚫 [Repeat API] Processing cancellation:', { tenantId, expireDate });
      
      // IMPORTANT: Keep subscription active until period end
      // Data is NEVER deleted - tenant downgrades to FREE plan
      const expiry = expireDate ? new Date(expireDate) : new Date();

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'cancelled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: expiry
          // Note: Plan stays BASIC until expiry, then cron job downgrades to FREE
        }
      });

      console.log(`✅ [Repeat API] Tenant ${tenantId} cancelled, access until ${expiry.toISOString()}, then downgrades to FREE (data preserved)`);
      break;

    case 'reactive':
      console.log('🔄 [Repeat API] Processing reactivation:', { tenantId, nextPaymentDate });
      
      const reactivePeriodEnd = nextPaymentDate ? new Date(nextPaymentDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'active',
          cancelAtPeriodEnd: false,
          currentPeriodEnd: reactivePeriodEnd
        }
      });

      console.log(`✅ [Repeat API] Tenant ${tenantId} reactivated until ${reactivePeriodEnd.toISOString()}`);
      break;

    default:
      console.warn('⚠️ [Repeat API] Unknown event type:', body);
  }

  const processingTime = Date.now() - startTime;
  return NextResponse.json({
    ok: true,
    eventType,
    tenantId,
    webhookId,
    message: `Repeat API webhook processed successfully (${eventType})`,
    processingTime: `${processingTime}ms`
  });
}

/**
 * Tilopay Webhook Handler (Subscriptions & Payments)
 * Handles payment confirmations and subscription events from Tilopay
 * 
 * Endpoint: POST /api/tilopay/webhook
 * 
 * Events handled:
 * - Repeat API webhooks (webhook_subscribe, webhook_payment, etc.)
 * - SDK webhooks (payment.approved, subscription.renewed, etc.)
 * 
 * Expected payload format:
 * Repeat API: { id_plan, id_suscriptor, next_payment_date, email, amount, auth, expire, ... }
 * SDK: { event, estado, referencia, monto, transaccion_id, ... }
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const webhookId = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    
    // Verify webhook authenticity
    if (!verifyWebhookSharedSecret(req)) {
      logWebhookEvent('error', 'Unauthorized webhook - Invalid secret', { webhookId });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    console.log('📨 [Tilopay Webhook] Received event:', body.event || body.id_plan ? 'Repeat API' : 'SDK webhook');

    // Detect Tilopay Repeat API webhooks (webhook_subscribe, webhook_payment, etc.)
    // These have different structure: { id_plan, id_suscriptor, next_payment_date, email, amount, auth, expire, etc. }
    if (body.id_plan) {
      console.log('🔄 [Tilopay Webhook] Detected Repeat API webhook');
      return handleRepeatAPIWebhook(body, webhookId, startTime);
    }

    // Extract event type and status for SDK-style webhooks
    const eventType: string = String(body.event || body.tipo || '').toLowerCase();
    const status: string = String(body.estado || body.status || '').toLowerCase();
    const ref: string = String(body.referencia || body.reference || '');
    const transactionId = body.transaccion_id || body.transaction_id || body.id;
    const amount = body.monto || body.amount;
    const currency = body.moneda || body.currency || 'CRC';
    const paymentMethod = body.metodo_pago || body.payment_method || 'tilopay';
    const declineReason = body.razon_rechazo || body.decline_reason || body.reason || 'Unknown';

    console.log(`📨 [Tilopay Webhook] SDK Event: ${eventType || 'payment'}, Status: ${status}, Ref: ${ref}`);

    // Parse reference to extract tenant and plan
    const [tenantId, planId] = ref.split('-');
    if (!tenantId || !planId) {
      logWebhookEvent('warn', 'Invalid reference format - ignoring webhook', { webhookId, reference: ref });
      return NextResponse.json({ ok: true, ignored: true, reason: 'Invalid reference format' });
    }

    // Validate plan exists
    const validPlans = ['FREE', 'BASIC', 'PRO'];
    if (!validPlans.includes(planId.toUpperCase())) {
      logWebhookEvent('error', `Invalid plan ID: ${planId}`, { webhookId, tenantId, planId });
      return NextResponse.json({ 
        ok: false, 
        error: 'Invalid plan ID',
        validPlans: validPlans
      }, { status: 400 });
    }

    // Get tenant info for logging
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, plan: true, subscriptionStatus: true, cancelAtPeriodEnd: true }
    });

    if (!tenant) {
      console.error(`❌ [Tilopay Webhook] Tenant not found: ${tenantId}`);
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const oldPlan = tenant.plan;
    const oldStatus = tenant.subscriptionStatus;

    // Handle subscription.renewed event
    if (eventType === 'subscription.renewed' || eventType === 'subscription_renewed') {
      console.log(`🔄 [Tilopay Webhook] Subscription renewed for tenant ${tenantId}`);
      
      // Check for duplicate
      const existingTransaction = await prisma.billingTransaction.findFirst({
        where: {
          tenantId: tenantId,
          description: { contains: transactionId }
        }
      });

      if (existingTransaction) {
        return NextResponse.json({ 
          ok: true, 
          message: 'Duplicate renewal webhook',
          alreadyProcessed: true,
          webhookId
        });
      }

      // Extend subscription period
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30); // 30 days

      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        }
      });

      // Create billing transaction
      await prisma.billingTransaction.create({
        data: {
          tenantId: tenantId,
          amount: amount || 0,
          currency: currency,
          status: 'success',
          description: `Renovación automática ${planId.toUpperCase()} [${transactionId}]`,
          paymentMethod: paymentMethod,
          periodStart: now,
          periodEnd: periodEnd
        }
      });

      console.log(`✅ [Tilopay Webhook] Subscription renewed successfully for ${tenantId}`);
      
      return NextResponse.json({ 
        ok: true, 
        event: 'subscription.renewed',
        tenantId,
        webhookId
      });
    }

    // Handle subscription.cancelled event
    if (eventType === 'subscription.cancelled' || eventType === 'subscription_cancelled') {
      console.log(`❌ [Tilopay Webhook] Subscription cancelled for tenant ${tenantId}`);
      
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'cancelled',
          cancelAtPeriodEnd: true,
        }
      });

      console.log(`✅ [Tilopay Webhook] Subscription marked as cancelled for ${tenantId}`);
      
      return NextResponse.json({ 
        ok: true, 
        event: 'subscription.cancelled',
        tenantId,
        webhookId
      });
    }

    // Handle initial payment or manual renewal (payment.approved / aprobada)
    if (['aprobada', 'approved', 'success', 'paid'].includes(status) || eventType === 'payment.approved') {
      
      logWebhookEvent('info', `Payment approved for tenant ${tenantId}`, {
        webhookId,
        tenantId,
        amount,
        transactionId
      });

      // Check for duplicate processing
      const existingTransaction = await prisma.billingTransaction.findFirst({
        where: {
          tenantId: tenantId,
          stripePaymentId: transactionId
        }
      });

      if (existingTransaction) {
        console.log(`⚠️ [Tilopay Webhook] Duplicate transaction detected: ${transactionId}`);
        return NextResponse.json({ 
          ok: true, 
          message: 'Duplicate transaction - already processed',
          webhookId
        });
      }

      // Create billing transaction record
      try {
        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount: amount || 0,
            currency: currency,
            status: 'success',
            description: `Pago procesado via Tilopay [${transactionId}]`,
            paymentMethod: paymentMethod,
            stripePaymentId: transactionId,
            periodStart: new Date(),
            periodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          }
        });
        
        console.log(`✅ [Tilopay Webhook] Billing transaction created for ${tenantId}`);
      } catch (txError) {
        logWebhookEvent('error', `Failed to create billing transaction [${webhookId}]`, {
          webhookId,
          tenantId,
          error: txError,
        });
      }

    } else if (['rechazada', 'declined', 'failed', 'canceled', 'cancelada'].includes(status)) {
      logWebhookEvent('error', `Payment DECLINED/FAILED [${webhookId}]`, {
        webhookId,
        tenantId,
        planId,
        status,
        declineReason
      });
      
      // Update subscription status to indicate payment failure
      try {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: { 
            subscriptionStatus: 'payment_failed',
          }
        });
      } catch (updateError) {
        logWebhookEvent('error', `Failed to update tenant status [${webhookId}]`, {
          webhookId,
          tenantId,
          error: updateError,
          status: 'payment_failed'
        });
        throw updateError;
      }

      // Create failed billing transaction record
      try {
        const failedDate = new Date();
        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount: amount || 0,
            currency: currency,
            status: 'failed',
            description: `Suscripción ${planId.toUpperCase()} - Pago rechazado [${transactionId}] - Razón: ${status}`,
            paymentMethod: paymentMethod,
            periodStart: failedDate,
            periodEnd: failedDate
          }
        });
      } catch (txError) {
        console.error('[Tilopay Webhook] Failed to record failed transaction:', txError);
      }

      // Create audit log for declined payment
      try {
        await prisma.auditLog.create({
          data: {
            tenantId: tenantId,
            userId: 'system',
            userName: 'Tilopay Webhook',
            userRole: 'SYSTEM',
            action: 'UPDATE',
            entityType: 'subscription',
            entityId: transactionId,
            entityName: `${planId.toUpperCase()} Plan - Payment Failed`,
            oldValues: {
              plan: oldPlan,
              status: oldStatus,
              webhookEvent: 'payment_declined'
            },
            newValues: {
              ...body,
              plan: oldPlan,
              status: 'payment_failed',
              webhookEvent: 'payment_declined',
              declineReason: status,
              processedAt: new Date().toISOString()
            }
          }
        });
      } catch (auditError) {
        console.error('[Tilopay Webhook] Failed to create decline audit log:', auditError);
      }

    } else {
      logWebhookEvent('warn', `Unknown payment status [${webhookId}]`, { webhookId, status });
    }

    const processingTime = Date.now() - startTime;

    return NextResponse.json({ 
      ok: true, 
      status: status,
      tenantId: tenantId,
      plan: planId,
      webhookId,
      processingTime: `${processingTime}ms`
    });

  } catch (e: any) {
    const processingTime = Date.now() - startTime;
    logWebhookEvent('error', `Webhook processing failed [${webhookId}]`, {
      webhookId,
      error: e?.message || 'Unknown error',
      stack: e?.stack,
      processingTime: `${processingTime}ms`
    });
    
    return NextResponse.json({ 
      error: e?.message || 'Webhook error',
      webhookId,
      details: e?.stack,
      processingTime: `${processingTime}ms`
    }, { status: 500 });
  }
}


