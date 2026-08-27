import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { verifyWebhookSharedSecret } from '@/lib/tilopay';
import { sendCAPIEvent } from '@/lib/meta-capi';
import { startTenantBillingGrace } from '@/lib/billing-access';

// Force dynamic rendering for webhooks
export const dynamic = 'force-dynamic';

// Enhanced logging utility for webhook troubleshooting
function logWebhookEvent(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>, tenantId?: string) {
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
          data: data ? JSON.stringify({
            webhookId: data.webhookId,
            status: data.status,
            eventType: data.eventType,
            processingTime: data.processingTime,
            matches: data.matches,
            code: data.code,
          }) : null,
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
    const amount = body.amount;
    const nextPaymentDate = body.next_payment_date;
    const expireDate = body.expire;
    const auth = body.auth;  // Authorization code for payments

    // Log event shape only; never subscriber or authorization data.
    console.log('📊 [Repeat API] Webhook data:', { 
      tilopayPlanId, 
      amount,
      nextPaymentDate,
      expireDate,
      hasSubscriberId: Boolean(suscriptorId),
      hasAuth: Boolean(auth),
    });

    // Determine event type from payload structure
    let eventType = 'unknown';
    if (nextPaymentDate && auth) {
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
    const matchedTenants = await prisma.tenant.findMany({
      where: suscriptorId
        ? {
            OR: [
              { tilopaySubscriptionId: tilopayPlanId },
              { tilopayCustomerId: String(suscriptorId) },
            ],
          }
        : { tilopaySubscriptionId: tilopayPlanId },
      take: 2,
    });

    if (matchedTenants.length !== 1) {
      console.warn('⚠️ [Repeat API] Tenant correlation failed', { matches: matchedTenants.length });
      return NextResponse.json({
        error: 'Payment correlation failed',
        webhookId,
      }, { status: 409 });
    }

    const tenant = matchedTenants[0];
    return await processRepeatEvent(eventType, tenant.id, body, webhookId, startTime);

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('❌ [Repeat API] Webhook error:', error);
    return NextResponse.json({
      error: 'Webhook processing failed',
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
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('Correlated tenant no longer exists');
  const settings = tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings)
    ? tenant.settings as Record<string, any>
    : {};
  const pendingCheckout = settings.billingPendingCheckout as Record<string, any> | undefined;
  const pendingPlan = pendingCheckout?.correlationId === tilopayPlanId
    ? String(pendingCheckout.plan || '').toUpperCase()
    : '';
  const entitlementPlan = ['BASIC', 'PRO'].includes(pendingPlan)
    ? pendingPlan
    : (tenant.plan === 'BASIC' || tenant.plan === 'PRO' ? tenant.plan : null);

  switch (eventType) {
    case 'subscribe':
      console.log('✅ [Repeat API] Processing subscription registration');
      
      // Calculate billing period (30 days from now or from next_payment_date)
      const now = new Date();
      const periodEnd = nextPaymentDate ? new Date(nextPaymentDate) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const pendingAmountMatches = !pendingCheckout || Number(pendingCheckout.amount) === amount;
      if (!auth || amount <= 0 || !entitlementPlan || !pendingAmountMatches) {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            tilopaySubscriptionId: tilopayPlanId,
            tilopayCustomerId: suscriptorId ? String(suscriptorId) : tenant.tilopayCustomerId,
          },
        });
        break;
      }

      const { billingPendingCheckout: _completedCheckout, ...retainedSettings } = settings;
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: entitlementPlan as any,
          subscriptionStatus: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          tilopaySubscriptionId: tilopayPlanId,
          tilopayCustomerId: suscriptorId ? String(suscriptorId) : tenant.tilopayCustomerId,
          settings: retainedSettings,
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
            description: `Pago inicial suscripción ${entitlementPlan} [${webhookId}]`,
            paymentMethod: 'tilopay-repeat',
            periodStart: now,
            periodEnd: periodEnd
          }
        });
        console.log(`💰 [Repeat API] Initial payment logged: ₡${amount}`);
      }

      console.log(`✅ [Repeat API] Subscription activated until ${periodEnd.toISOString()}`);

      sendCAPIEvent({
        eventName: 'Subscribe',
        eventId: crypto.randomUUID(),
        email: body.email || undefined,
        value: amount || undefined,
        currency: 'CRC',
      });

      if (auth && amount > 0) {
        sendCAPIEvent({
          eventName: 'Purchase',
          eventId: crypto.randomUUID(),
          email: body.email || undefined,
          value: amount,
          currency: 'CRC',
        });
      }

      break;

    case 'payment':
      console.log('💰 [Repeat API] Processing recurring payment', { amount });

      if (!entitlementPlan || amount <= 0 || !auth) {
        throw new Error('Recurring payment lacks an approved plan or payment proof');
      }
      
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
          plan: entitlementPlan as any,
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
          description: `Renovación mensual ${entitlementPlan} [${webhookId}]`,
          paymentMethod: 'tilopay-repeat',
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd
        }
      });

      console.log(`✅ [Repeat API] Tenant ${tenantId} renewed until ${newPeriodEnd.toISOString()}`);

      sendCAPIEvent({
        eventName: 'Purchase',
        eventId: crypto.randomUUID(),
        email: body.email || undefined,
        value: amount,
        currency: 'CRC',
      });

      break;

    case 'rejected':
      console.log('❌ [Repeat API] Processing payment failure:', { tenantId, reason: body.reason });
      
      await startTenantBillingGrace(tenantId);
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
      // A provider-side reactivation event is not proof of a successful charge.
      // Keep the existing entitlement state until the next verified payment.
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          cancelAtPeriodEnd: false,
        }
      });
      break;

    default:
      console.warn('⚠️ [Repeat API] Unknown event type');
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
    // Read raw body once so HMAC verification can use the exact payload
    const rawBody = await req.text();
    if (!verifyWebhookSharedSecret(req, rawBody)) {
      logWebhookEvent('error', 'Unauthorized webhook - Invalid secret', { webhookId });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      logWebhookEvent('error', 'Invalid JSON payload', { webhookId });
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }
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
    const amount = Number(body.monto || body.amount || 0);
    const currency = body.moneda || body.currency || 'CRC';
    const paymentMethod = body.metodo_pago || body.payment_method || 'tilopay';
    console.log('📨 [Tilopay Webhook] SDK event received', { eventType: eventType || 'payment', status });

    // Parse reference to extract tenant and plan
    const lastSeparator = ref.lastIndexOf('-');
    const planSeparator = lastSeparator > 0 ? ref.lastIndexOf('-', lastSeparator - 1) : -1;
    const tenantId = planSeparator > 0 ? ref.slice(0, planSeparator) : '';
    const planId = planSeparator > 0 ? ref.slice(planSeparator + 1, lastSeparator) : '';
    if (!tenantId || !planId) {
      logWebhookEvent('warn', 'Invalid reference format - ignoring webhook', { webhookId });
      return NextResponse.json({ ok: true, ignored: true, reason: 'Invalid reference format' });
    }

    // Validate plan exists
    const normalizedPlan = planId.toUpperCase();
    const validPlans = ['BASIC', 'PRO'];
    if (!validPlans.includes(normalizedPlan)) {
      logWebhookEvent('error', 'Invalid paid plan ID', { webhookId });
      return NextResponse.json({ 
        ok: false, 
        error: 'Invalid plan ID',
        validPlans
      }, { status: 400 });
    }

    // Get tenant info for logging
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, plan: true, subscriptionStatus: true, cancelAtPeriodEnd: true }
    });

    if (!tenant) {
      console.error('❌ [Tilopay Webhook] Correlated tenant not found');
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const oldPlan = tenant.plan;
    const oldStatus = tenant.subscriptionStatus;

    // Handle subscription.renewed event
    if (eventType === 'subscription.renewed' || eventType === 'subscription_renewed') {
      if (!transactionId || amount <= 0 || tenant.plan !== normalizedPlan) {
        return NextResponse.json({ error: 'Renewal proof does not match the active plan' }, { status: 409 });
      }
      
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

      await prisma.$transaction([
        prisma.tenant.update({
          where: { id: tenantId },
          data: {
            subscriptionStatus: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
          }
        }),
        prisma.billingTransaction.create({
          data: {
            tenantId,
            amount,
            currency,
            status: 'success',
            description: `Renovación automática ${normalizedPlan} [${String(transactionId)}]`,
            paymentMethod,
            stripePaymentId: String(transactionId),
            periodStart: now,
            periodEnd,
          }
        }),
      ]);
      
      return NextResponse.json({ 
        ok: true, 
        event: 'subscription.renewed',
        webhookId
      });
    }

    // Handle subscription.cancelled event
    if (eventType === 'subscription.cancelled' || eventType === 'subscription_cancelled') {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          subscriptionStatus: 'cancelled',
          cancelAtPeriodEnd: true,
        }
      });

      return NextResponse.json({ 
        ok: true, 
        event: 'subscription.cancelled',
        webhookId
      });
    }

    // Handle initial payment or manual renewal (payment.approved / aprobada)
    if (['aprobada', 'approved', 'success', 'paid'].includes(status) || eventType === 'payment.approved') {
      
      const isInitialBasicCheckout = normalizedPlan === 'BASIC' && currency === 'USD' && amount === 2000;
      const isExistingPlanRenewal = tenant.plan === normalizedPlan && tenant.subscriptionStatus === 'active' && amount > 0;
      if (!transactionId || (!isInitialBasicCheckout && !isExistingPlanRenewal)) {
        return NextResponse.json({ error: 'Payment does not match a server-priced entitlement' }, { status: 409 });
      }

      logWebhookEvent('info', 'Payment approved', { webhookId });

      // Check for duplicate processing
      const existingTransaction = await prisma.billingTransaction.findFirst({
        where: {
          tenantId: tenantId,
          stripePaymentId: String(transactionId)
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

      const periodStart = new Date();
      const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
      await prisma.$transaction([
        prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: normalizedPlan as any,
            subscriptionStatus: 'active',
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
            trialEndsAt: null,
            cancelAtPeriodEnd: false,
          },
        }),
        prisma.billingTransaction.create({
          data: {
            tenantId,
            amount,
            currency,
            status: 'success',
            description: `Pago procesado via Tilopay [${String(transactionId)}]`,
            paymentMethod,
            stripePaymentId: String(transactionId),
            periodStart,
            periodEnd,
          }
        }),
      ]);

      sendCAPIEvent({
        eventName: 'Purchase',
        eventId: crypto.randomUUID(),
        value: amount,
        currency,
      });

    } else if (['rechazada', 'declined', 'failed', 'canceled', 'cancelada'].includes(status)) {
      logWebhookEvent('error', `Payment DECLINED/FAILED [${webhookId}]`, {
        webhookId,
        tenantId,
        planId,
        status
      });
      
      // Update subscription status to indicate payment failure
      try {
        await startTenantBillingGrace(tenantId);
      } catch (updateError) {
        logWebhookEvent('error', 'Failed to update tenant status', {
          webhookId,
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
            userId: null,
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
              plan: oldPlan,
              status: 'payment_failed',
              webhookEvent: 'payment_declined',
              declineReason: String(status),
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
      webhookId,
      processingTime: `${processingTime}ms`
    });

  } catch (e: any) {
    const processingTime = Date.now() - startTime;
    logWebhookEvent('error', 'Webhook processing failed', {
      webhookId,
      code: e?.name || 'webhook_error',
      processingTime: `${processingTime}ms`
    });
    
    return NextResponse.json({ 
      error: 'Webhook processing failed',
      webhookId,
      processingTime: `${processingTime}ms`
    }, { status: 500 });
  }
}


