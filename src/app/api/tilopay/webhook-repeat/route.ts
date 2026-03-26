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
    
    
    // Verify webhook authenticity
    // TiloPay Repeat uses hash-tilopay header for authentication
    // We verify if hash-tilopay is present OR if x-tilopay-secret matches
    const hashTilopay = request.headers.get('hash-tilopay');
    const hasWebhookSecret = !!process.env.TILOPAY_WEBHOOK_SECRET;
    
    if (hasWebhookSecret) {
      // TiloPay Repeat uses hash-tilopay header, not x-tilopay-secret
      if (hashTilopay) {
        // If hash-tilopay is present, accept it (TiloPay's authentication method)
      } else if (verifyWebhookSharedSecret(request)) {
        // Fallback to x-tilopay-secret if provided
      } else {
        // No valid authentication found - don't log secret values
        console.error(`❌ [WEBHOOK-REPEAT] Unauthorized webhook - No valid authentication [${webhookId}]`);
        console.error(`❌ [WEBHOOK-REPEAT] hash-tilopay header present: ${!!hashTilopay}`);
        console.error(`❌ [WEBHOOK-REPEAT] x-tilopay-secret header present: ${!!request.headers.get('x-tilopay-secret')}`);
        
        // For testing: Allow if hash-tilopay exists (TiloPay's method) even if secret doesn't match
        // TODO: Implement proper hash verification based on TiloPay's documentation
        if (!hashTilopay) {
          return NextResponse.json({ error: 'Unauthorized - No authentication provided' }, { status: 401 });
        }
      }
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
      console.error(`❌ [WEBHOOK-REPEAT] Failed to parse JSON payload [${webhookId}]:`, parseError);
      console.error(`❌ [WEBHOOK-REPEAT] Raw body was:`, rawBody.substring(0, 1000));
      return NextResponse.json({ 
        error: 'Invalid JSON payload',
        message: parseError.message,
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
    let event = 'payment_success'; // Default for Tilopay Repeat

    // Detect format and extract data
    if (payload.email && payload.id_plan) {
      // Format 1: Direct Tilopay Repeat format
      subscriberEmail = payload.email;
      amount = parseFloat(payload.amount || 0);
      planId = payload.id_plan;
      paymentId = payload.paymentId || payload.payment_id;
      orderNumber = payload.orderNumber || payload.order_number;
      status = payload.status || payload.estado || payload.state;
      
    } else if (payload.event && payload.data) {
      // Format 2: Structured event format
      subscriberEmail = payload.data.email || payload.data.subscriber_email || payload.data.billToEmail;
      amount = parseFloat(payload.data.amount || 0);
      event = payload.event;
      paymentId = payload.data.paymentId || payload.data.payment_id;
      status = payload.data.status || payload.data.estado || payload.data.state;
      orderNumber = payload.data.orderNumber || payload.data.order_number;
      
    } else {
      console.error(`❌ [WEBHOOK-REPEAT] Unknown webhook format [${webhookId}]:`, payload);
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
                           event.includes('payment_success') ||
                           event.includes('subscription.created');
    
    // ========================================================================
    // TENANT IDENTIFICATION - Using Email (Simple approach)
    // ========================================================================
    
    if (!subscriberEmail) {
      console.error(`❌ [WEBHOOK-REPEAT] No subscriber email in webhook [${webhookId}]`);
      return NextResponse.json({ 
        error: 'No subscriber email',
        webhookId 
      }, { status: 400 });
    }

    // Normalize email (trim and lowercase for matching)
    const normalizedEmail = subscriberEmail.trim().toLowerCase();

    // Find user and their tenant through memberships
    // Try exact match first, then case-insensitive search
    let user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
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
                plan: true,
                subscriptionStatus: true,
                tilopaySubscriptionId: true
              }
            }
          }
        }
      }
    });

    // If not found with exact match, try case-insensitive search
    if (!user) {
      const allUsers = await prisma.user.findMany({
        where: {
          email: {
            contains: normalizedEmail,
            mode: 'insensitive'
          }
        },
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
                  plan: true,
                  subscriptionStatus: true,
                  tilopaySubscriptionId: true
                }
              }
            }
          }
        }
      });
      
      if (allUsers.length > 0) {
        user = allUsers[0];
      }
    }

    if (!user) {
      console.error(`❌ [WEBHOOK-REPEAT] User not found: "${normalizedEmail}" [${webhookId}]`);
      console.error(`❌ [WEBHOOK-REPEAT] Available payload fields:`, Object.keys(payload));
      return NextResponse.json({ 
        error: `User not found: ${normalizedEmail}`,
        webhookId,
        searchedEmail: normalizedEmail,
        payloadKeys: Object.keys(payload)
      }, { status: 404 });
    }

    // Get the user's tenant (prefer default, fallback to first membership)
    const membership = user.memberships.find(m => m.tenantId === user.defaultTenantId) || user.memberships[0];
    
    if (!membership) {
      console.error(`❌ [WEBHOOK-REPEAT] No active tenant membership for user: ${subscriberEmail}`);
      return NextResponse.json({ error: 'User has no active tenant' }, { status: 404 });
    }

    const tenantId = membership.tenantId;
    const tenant = membership.tenant;

    // Determine plan from amount
    // BASIC Plan: $15 USD/month (₡15,000 CRC) or ~15,000 colones
    // PRO Plan: $45 USD/month (₡45,000 CRC) or ~45,000 colones
    // 
    // TiloPay might send amount in USD or CRC, so we check both:
    // - If amount >= 40,000 it's likely in colones (PRO = 45,000)
    // - If amount >= 40 and < 1,000 it's likely in USD (PRO = $45)
    // - If amount >= 10,000 it's likely in colones (BASIC = 15,000)
    // - If amount >= 10 and < 1,000 it's likely in USD (BASIC = $15)
    
    let newPlan = 'FREE';
    const currency = payload.currency || payload.moneda || 'USD';
    const isColones = currency === 'CRC' || currency === '₡' || amount >= 1000;
    
    if (isColones) {
      // Amount is in colones
      if (amount >= 40000) {
        newPlan = 'PRO';
      } else if (amount >= 10000) {
        newPlan = 'BASIC';
      } else {
        newPlan = tenant.plan || 'FREE';
      }
    } else {
      // Amount is in USD
      if (amount >= 40) {
        newPlan = 'PRO';
      } else if (amount >= 10) {
        newPlan = 'BASIC';
      } else {
        newPlan = tenant.plan || 'FREE';
      }
    }
    
    // Also try to detect plan from planId if provided
    if (planId) {
      const planIdUpper = String(planId).toUpperCase();
      if (['BASIC', 'PRO', 'FREE'].includes(planIdUpper)) {
        newPlan = planIdUpper;
      }
    }

    // Process successful payment if:
    // 1. paymentId is present, OR
    // 2. status indicates success, OR
    // 3. event indicates success
    const isPaymentSuccess = paymentId || isSuccessStatus;
    
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
      
      try {
        const updatedTenant = await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            plan: newPlan as any, // Cast to any to ensure it's accepted
            subscriptionStatus: 'active',
            tilopaySubscriptionId: orderNumber || paymentId?.toString(),
            currentPeriodStart: now,
            currentPeriodEnd: nextBillingDate,
            trialEndsAt: null, // Clear trial end date
            cancelAtPeriodEnd: false // Clear any cancellation flags
          }
        });

      } catch (updateError: any) {
        console.error(`❌ [WEBHOOK-REPEAT] Failed to update tenant in database [${webhookId}]:`, updateError);
        console.error(`   Error message: ${updateError.message}`);
        console.error(`   Error code: ${updateError.code}`);
        console.error(`   Tenant ID: ${tenantId}`);
        console.error(`   New Plan: ${newPlan}`);
        throw updateError;
      }
      
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
        tenantId: tenantId,
        oldPlan: tenant.plan,
        newPlan,
        paymentId
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
            plan: 'FREE',
            subscriptionStatus: 'cancelled',
            tilopaySubscriptionId: null
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

