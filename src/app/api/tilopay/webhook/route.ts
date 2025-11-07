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
 * Tilopay Webhook Handler (One-time payments)
 * Handles payment confirmations from Tilopay for one-time subscription purchases
 * 
 * Endpoint: POST /api/tilopay/webhook
 * 
 * Expected payload format:
 * {
 *   estado: 'aprobada' | 'rechazada' | 'cancelada',
 *   referencia: '{tenantId}-{planId}-{timestamp}',
 *   monto: number,
 *   transaccion_id: string,
 *   ...
 * }
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

    // Extract status and reference with enhanced validation
    const status: string = String(body.estado || body.status || '').toLowerCase();
    const ref: string = String(body.referencia || body.reference || '');
    const transactionId = body.transaccion_id || body.transaction_id || body.id;
    const amount = body.monto || body.amount;
    const currency = body.moneda || body.currency || 'USD';
    const paymentMethod = body.metodo_pago || body.payment_method || 'tilopay';
    const declineReason = body.razon_rechazo || body.decline_reason || body.reason || 'Unknown';

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

    // Handle different payment statuses
    if (['aprobada', 'approved', 'success', 'paid'].includes(status)) {
      
      // Check for duplicate processing
      const existingTransaction = await prisma.billingTransaction.findFirst({
        where: {
          tenantId: tenantId,
          description: { contains: transactionId }
        }
      });

      if (existingTransaction) {
        logWebhookEvent('warn', `Duplicate webhook detected [${webhookId}]`, { webhookId, tenantId });
        return NextResponse.json({ 
          ok: true, 
          message: 'Duplicate webhook - already processed',
          alreadyProcessed: true,
          webhookId
        });
      }

      // Calculate billing period
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setDate(periodEnd.getDate() + 30); // 30 days subscription

      // Update tenant plan and status
      try {
        const updatedTenant = await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: planId.toUpperCase() as any,
            subscriptionStatus: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false, // Clear any cancellation flags
            tilopaySubscriptionId: transactionId,
          }
        });
      } catch (updateError) {
        logWebhookEvent('error', `Failed to update tenant [${webhookId}]`, {
          webhookId,
          tenantId,
          error: updateError,
        });
        throw updateError;
      }

      // Create billing transaction record
      try {
        await prisma.billingTransaction.create({
          data: {
            tenantId: tenantId,
            amount: amount || 0,
            currency: currency,
            status: 'success',
            description: `Suscripción ${planId.toUpperCase()} - Pago único [${transactionId}]`,
            paymentMethod: paymentMethod,
            periodStart: now,
            periodEnd: periodEnd
          }
        });
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


