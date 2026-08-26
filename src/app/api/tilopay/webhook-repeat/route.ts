import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { verifyWebhookSharedSecret } from '@/lib/tilopay';
import { sendCAPIEvent } from '@/lib/meta-capi';

// Force dynamic rendering for webhooks
export const dynamic = 'force-dynamic';

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

// GET handler for testing webhook endpoint reachability
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'ok',
    message: 'Webhook endpoint is reachable',
    endpoint: '/api/tilopay/webhook-repeat',
    method: 'POST',
    timestamp: new Date().toISOString()
  });
}

export async function POST(request: NextRequest) {
  const webhookId = `webhook-repeat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  // Log webhook receipt (essential for debugging)
  console.error(`[WEBHOOK-REPEAT] POST request received [${webhookId}]`);
  
  try {
    
    // Get raw body text first for debugging
    let rawBody = '';
    try {
      const reader = request.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        rawBody = new TextDecoder().decode(new Uint8Array(chunks.flatMap(c => Array.from(c))));
      }
    } catch (bodyError) {
      console.error(`⚠️ [WEBHOOK-REPEAT] Error reading raw body [${webhookId}]:`, bodyError);
    }
    
    
    // Fail-closed: require verified shared secret or HMAC over raw body
    if (!verifyWebhookSharedSecret(request, rawBody || undefined)) {
      console.error(`❌ [WEBHOOK-REPEAT] Unauthorized webhook [${webhookId}]`, {
        hasHashHeader: !!request.headers.get('hash-tilopay'),
        hasSecretHeader: !!request.headers.get('x-tilopay-secret'),
        hasRawBody: !!rawBody,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Parse JSON payload
    let payload: any;
    try {
      if (rawBody) {
        payload = JSON.parse(rawBody);
      } else {
        // Fallback to request.json() if raw body read failed
        payload = await request.json();
      }
    } catch (parseError: any) {
      console.error(`❌ [WEBHOOK-REPEAT] Failed to parse JSON payload [${webhookId}]`);
      return NextResponse.json({ 
        error: 'Invalid JSON payload',
        webhookId
      }, { status: 400 });
    }

    // Tilopay Repeat sends different formats:
    // Format 1 (actual): { id_plan, email, amount, auth, orderNumber, paymentId, status, estado }
    // Format 2 (future): { event, data: { ... } }
    
    let subscriberEmail: string | null = null;
    let amount = 0;
    let planId = null;
    let paymentId = null;
    let orderNumber = null;
    let status = null;
    let event = 'unknown';

    // Detect format and extract data
    if (payload.email && payload.id_plan) {
      // Format 1: Direct Tilopay Repeat format
      subscriberEmail = payload.email;
      amount = parseFloat(payload.amount || 0);
      planId = payload.id_plan;
      paymentId = payload.paymentId || payload.payment_id;
      orderNumber = payload.orderNumber || payload.order_number;
      status = payload.status || payload.estado || payload.state;
      event = 'payment';
      
    } else if (payload.event && payload.data) {
      // Format 2: Structured event format
      subscriberEmail = payload.data.email || payload.data.subscriber_email || payload.data.billToEmail;
      amount = parseFloat(payload.data.amount || 0);
      event = payload.event;
      planId = payload.data.id_plan || payload.data.planId || payload.data.plan_id;
      paymentId = payload.data.paymentId || payload.data.payment_id;
      status = payload.data.status || payload.data.estado || payload.data.state;
      orderNumber = payload.data.orderNumber || payload.data.order_number;
      
    } else {
      console.error(`❌ [WEBHOOK-REPEAT] Unknown webhook format [${webhookId}]`);
      return NextResponse.json({ 
        error: 'Unknown payload format',
        webhookId,
        receivedKeys: Object.keys(payload)
      }, { status: 400 });
    }
    
    // Normalize status to check for success
    const statusLower = status ? String(status).toLowerCase() : '';
    const isSuccessStatus = statusLower.includes('success') || 
                           statusLower.includes('aprobada') || 
                           statusLower.includes('approved') || 
                           statusLower.includes('paid') ||
                           statusLower.includes('completed') ||
                           event.includes('payment_success');
    
    if (!planId) {
      return NextResponse.json({ error: 'Missing payment correlation ID', webhookId }, { status: 400 });
    }

    const correlationId = String(planId);
    const matchedTenants = await prisma.tenant.findMany({
      where: { tilopaySubscriptionId: correlationId },
      take: 2,
    });

    if (matchedTenants.length !== 1) {
      console.error(`❌ [WEBHOOK-REPEAT] Correlation failed [${webhookId}]`, { matches: matchedTenants.length });
      return NextResponse.json({ error: 'Payment correlation failed', webhookId }, { status: 409 });
    }

    const tenant = matchedTenants[0];
    const tenantId = tenant.id;
    const membership = await prisma.membership.findFirst({
      where: { tenantId, isActive: true, role: 'OWNER', user: { active: true } },
      include: { user: true },
    });
    const user = membership?.user || null;
    const settings = tenant.settings && typeof tenant.settings === 'object' && !Array.isArray(tenant.settings)
      ? tenant.settings as Record<string, any>
      : {};
    const pendingCheckout = settings.billingPendingCheckout as Record<string, any> | undefined;
    const pendingPlan = pendingCheckout?.correlationId === correlationId
      ? String(pendingCheckout.plan || '').toUpperCase()
      : '';
    const newPlan = ['BASIC', 'PRO'].includes(pendingPlan)
      ? pendingPlan
      : (tenant.plan === 'BASIC' || tenant.plan === 'PRO' ? tenant.plan : null);
    if (!newPlan) {
      return NextResponse.json({ error: 'No approved plan for payment correlation', webhookId }, { status: 409 });
    }

    const currency = payload.currency || payload.moneda || pendingCheckout?.currency || 'CRC';
    const isColones = currency === 'CRC' || currency === '₡' || amount >= 1000;
    if (pendingCheckout && Number(pendingCheckout.amount) !== amount) {
      return NextResponse.json({ error: 'Payment amount does not match checkout', webhookId }, { status: 409 });
    }

    if (isSuccessStatus && (
      (!pendingCheckout && tenant.subscriptionStatus !== 'active') ||
      (!orderNumber && !paymentId) ||
      amount <= 0
    )) {
      return NextResponse.json({ error: 'Payment proof is incomplete', webhookId }, { status: 409 });
    }

    const isPaymentSuccess = isSuccessStatus;
    
    if (isPaymentSuccess) {
      
      // Check for duplicate transaction (idempotency)
      // Check both billing transactions AND audit logs to catch duplicates more reliably
      const uniqueIdentifier = orderNumber || paymentId?.toString();
      
      if (!uniqueIdentifier) {
        console.error('⚠️ No unique identifier (orderNumber or paymentId) - cannot check for duplicates');
      } else {
        // Check billing transactions
        const existingTransaction = await prisma.billingTransaction.findFirst({
          where: {
            tenantId: tenantId,
            description: { contains: uniqueIdentifier }
          }
        });

        if (existingTransaction) {
          return NextResponse.json({ 
            status: 'success',
            message: 'Duplicate webhook - already processed',
            alreadyProcessed: true,
            transactionId: existingTransaction.id
          });
        }

        // Also check audit logs as a backup check
        const existingAuditLog = await prisma.auditLog.findFirst({
          where: {
            tenantId: tenantId,
            entityType: 'subscription',
            entityId: uniqueIdentifier,
            action: 'UPDATE'
          }
        });

        if (existingAuditLog) {
          return NextResponse.json({ 
            status: 'success',
            message: 'Duplicate webhook - already processed (found in audit log)',
            alreadyProcessed: true,
            auditLogId: existingAuditLog.id
          });
        }
      }

      
      // Calculate next billing date (30 days from now for monthly subscriptions)
      const now = new Date();
      const nextBillingDate = new Date(now);
      nextBillingDate.setDate(nextBillingDate.getDate() + 30); // Monthly subscription
      const { billingPendingCheckout: _completedCheckout, ...retainedSettings } = settings;
      
      try {
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: newPlan as any, // Cast to any to ensure it's accepted
            subscriptionStatus: 'active',
            tilopaySubscriptionId: correlationId,
            currentPeriodStart: now,
            currentPeriodEnd: nextBillingDate,
            trialEndsAt: null, // Clear trial end date
            cancelAtPeriodEnd: false,
            settings: retainedSettings,
          }
        });

      } catch (updateError: any) {
        console.error(`❌ [WEBHOOK-REPEAT] Failed to update tenant [${webhookId}]`, updateError?.code || 'update_error');
        throw updateError;
      }
      
      // Create billing transaction record
      try {
        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount,
            currency: String(currency === '₡' ? 'CRC' : currency),
            status: 'success',
            description: `Suscripción ${newPlan} - Pago mensual [${orderNumber || paymentId}]`,
            paymentMethod: 'tilopay',
            periodStart: now,
            periodEnd: nextBillingDate
          }
        });

      } catch (transactionError) {
        console.error('⚠️ Failed to create billing transaction:', transactionError);
        // Don't fail the webhook if transaction logging fails
      }
      
      // Log the webhook event
      try {
        await prisma.auditLog.create({
          data: {
            tenantId: tenantId,
            userId: user?.id || null,
            userName: user?.name || 'Tilopay webhook',
            userRole: membership?.role || 'SYSTEM',
            action: 'UPDATE', // Subscription plan updated
            entityType: 'subscription',
            entityId: orderNumber || paymentId?.toString() || 'unknown',
            entityName: `${newPlan} Plan`,
            oldValues: {
              plan: tenant.plan,
              status: 'trial_or_previous'
            },
            newValues: {
              webhookEvent: 'tilopay_payment_success',
              plan: newPlan,
              status: 'active',
              correlationId,
              paymentReference: orderNumber || paymentId?.toString() || null,
            }
          }
        });
      } catch (auditError) {
        console.error('⚠️ Failed to log audit:', auditError);
      }

      sendCAPIEvent({
        eventName: 'Purchase',
        eventId: crypto.randomUUID(),
        email: subscriberEmail || undefined,
        value: amount,
        currency: currency === 'CRC' || isColones ? 'CRC' : 'USD',
      });

      if (tenant.plan === 'FREE' || !tenant.subscriptionStatus || tenant.subscriptionStatus !== 'active') {
        sendCAPIEvent({
          eventName: 'Subscribe',
          eventId: crypto.randomUUID(),
          email: subscriberEmail || undefined,
          value: amount,
          currency: currency === 'CRC' || isColones ? 'CRC' : 'USD',
        });
      }

      return NextResponse.json({ 
        status: 'success',
        message: 'Payment processed and plan updated',
        webhookId,
        oldPlan: tenant.plan,
        newPlan,
      });
    }

    // Handle other event types if provided
    switch (event) {
      case 'subscription.payment_failed':
      case 'payment_failed':
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            subscriptionStatus: 'payment_failed'
          }
        });
        break;

      case 'subscription.cancelled':
      case 'subscription.paused':
      case 'cancelled':
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            subscriptionStatus: 'cancelled',
            cancelAtPeriodEnd: true,
          }
        });
        break;
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
          userId: user?.id || null,
          userName: user?.name || 'Tilopay webhook',
          userRole: membership?.role || 'SYSTEM',
          action: auditAction,
          entityType: 'subscription',
          entityId: orderNumber || paymentId?.toString() || 'unknown',
          entityName: `${newPlan} Plan - ${event}`,
          oldValues: {
            plan: tenant.plan,
            status: 'previous'
          },
          newValues: {
            webhookEvent: event,
            plan: newPlan,
            correlationId,
          }
        }
      });
    } catch (auditError) {
      console.error('⚠️ Failed to log audit:', auditError);
    }

    return NextResponse.json({ 
      status: 'success',
      message: 'Webhook processed',
      event,
      newPlan
    });

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [WEBHOOK-REPEAT] Webhook error after ${processingTime}ms [${webhookId}]:`, error);
    console.error(`   Error message: ${error.message}`);
    console.error(`   Error stack: ${error.stack}`);
    
    // Log to webhook logs if we have tenant context
    try {
      if (error.tenantId) {
        await prisma.webhookLog.create({
          data: {
            tenantId: error.tenantId,
            level: 'error',
            message: `Webhook processing failed: ${error.message}`,
            data: JSON.stringify({
              webhookId,
              error: error.message,
              stack: error.stack,
              payload: error.payload
            }),
            source: 'tilopay-webhook-repeat'
          }
        }).catch(logErr => console.error('Failed to create webhook log:', logErr));
      }
    } catch (logError) {
      // Ignore logging errors
    }
    
    return NextResponse.json({ 
      error: 'Webhook processing failed',
      webhookId,
      processingTime: `${processingTime}ms`
    }, { status: 500 });
  }
}

