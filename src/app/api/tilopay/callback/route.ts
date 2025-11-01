import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Force dynamic rendering for callbacks
export const dynamic = 'force-dynamic';

// Enhanced logging utility for callback troubleshooting
function logCallbackEvent(level: 'info' | 'warn' | 'error', message: string, data?: any, tenantId?: string) {
  const timestamp = new Date().toISOString();
  
  console.log(`[${timestamp}] [${level.toUpperCase()}] [Tilopay Callback] ${message}`, data ? data : '');
  
  // Store in database for troubleshooting
  if (level === 'error' || level === 'warn') {
    prisma.webhookLog.create({
      data: {
        tenantId: tenantId || 'unknown',
        level,
        message,
        data: data ? JSON.stringify(data) : null,
        source: 'tilopay-callback'
      }
    }).catch(err => console.error('Failed to store callback log:', err));
  }
}

/**
 * Tilopay Payment Callback Handler
 * Receives payment confirmation from Tilopay SDK redirect
 * Endpoint: POST /api/tilopay/callback
 * 
 * After successful payment, redirects to /config?tab=facturacion
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const callbackId = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    logCallbackEvent('info', `Callback received [${callbackId}]`, {
      headers: Object.fromEntries(request.headers.entries()),
      url: request.url
    });
    
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
    
    logCallbackEvent('info', `Callback data received [${callbackId}]`, {
      callbackId,
      contentType,
      data
    });

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
      // Parse orderNumber to get tenant and plan
      // Format: {tenantId}-{planId}-{timestamp}
      const parts = orderNumber?.split('-');
      
      if (parts && parts.length >= 2) {
        const tenantId = parts[0];
        const planName = parts[1];
        
        try {
          // Get tenant info for audit log
          const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, name: true, plan: true, subscriptionStatus: true }
          });

          const oldPlan = tenant?.plan;
          const oldStatus = tenant?.subscriptionStatus;

          // Calculate billing period
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setDate(periodEnd.getDate() + 30); // 30 days

          // Validate plan exists
          const validPlans = ['FREE', 'BASIC', 'PRO'];
          if (!validPlans.includes(planName.toUpperCase())) {
          logCallbackEvent('error', `Invalid plan ID in callback: ${planName}`, {
            callbackId,
            tenantId,
            planName,
            validPlans
          });
            const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&payment=error`;
            return NextResponse.redirect(redirectUrl);
          }

          // Update tenant plan
          await prisma.tenant.update({
            where: { id: tenantId },
            data: {
              plan: planName.toUpperCase(),
              subscriptionStatus: 'active',
              tilopaySubscriptionId: cardToken || transactionId,
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false, // Clear any cancellation flags
              stripeSubscriptionId: null,
              stripeCustomerId: null
            }
          });


          // Create billing transaction record
          try {
            await prisma.billingTransaction.create({
              data: {
                tenantId: tenantId,
                amount: amount || 0,
                currency: currency || 'CRC',
                status: 'success',
                description: `Suscripción ${planName.toUpperCase()} - Callback [${transactionId}]`,
                paymentMethod: 'tilopay',
                periodStart: now,
                periodEnd: periodEnd
              }
            });
          } catch (txError) {
            console.error('⚠️ [Tilopay Callback] Failed to create billing transaction:', txError);
          }

          // Create audit log
          try {
            await prisma.auditLog.create({
              data: {
                tenantId: tenantId,
                userId: 'system',
                userName: 'Tilopay Callback',
                userRole: 'SYSTEM',
                action: 'UPDATE',
                entityType: 'subscription',
                entityId: transactionId,
                entityName: `${planName.toUpperCase()} Plan`,
                oldValues: {
                  plan: oldPlan,
                  status: oldStatus,
                  source: 'callback'
                },
                newValues: {
                  ...data,
                  plan: planName.toUpperCase(),
                  status: 'active',
                  source: 'callback',
                  processedAt: new Date().toISOString()
                }
              }
            });
          } catch (auditError) {
            console.error('⚠️ [Tilopay Callback] Failed to create audit log:', auditError);
          }
          
        } catch (dbError) {
          console.error('❌ [Tilopay Callback] Database update failed:', dbError);
          // Continue to redirect even if DB update fails
        }
      }

      // Redirect to billing section with success message
      const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&payment=success`;
      return NextResponse.redirect(redirectUrl);
      
    } else {
      console.error('❌ [Tilopay Callback] Payment failed or declined');

      // Try to extract tenant info for audit log
      const parts = orderNumber?.split('-');
      if (parts && parts.length >= 2) {
        const tenantId = parts[0];
        const planName = parts[1];
        
        try {
          // Create audit log for failed callback
          await prisma.auditLog.create({
            data: {
              tenantId: tenantId,
              userId: 'system',
              userName: 'Tilopay Callback',
              userRole: 'SYSTEM',
              action: 'UPDATE',
              entityType: 'subscription',
              entityId: transactionId || 'unknown',
              entityName: `${planName.toUpperCase()} Plan - Failed`,
              oldValues: {
                source: 'callback',
                status: 'pending'
              },
              newValues: {
                ...data,
                source: 'callback',
                status: 'failed',
                failureReason: message || status,
                processedAt: new Date().toISOString()
              }
            }
          });
        } catch (auditError) {
          console.error('⚠️ [Tilopay Callback] Failed to create failure audit log:', auditError);
        }
      }
      
      // Check if payment was cancelled vs failed
      const isCancelled = message?.toLowerCase().includes('cancel') || 
                          status?.toLowerCase().includes('cancel') ||
                          message?.toLowerCase().includes('cancelado');
      
      const paymentStatus = isCancelled ? 'cancelled' : 'error';
      const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&payment=${paymentStatus}`;
      return NextResponse.redirect(redirectUrl);
    }

    const processingTime = Date.now() - startTime;

  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [Tilopay Callback] Error after ${processingTime}ms:`, error);
    console.error('Stack trace:', error.stack);
    
    // Still try to redirect to show user something
    const redirectUrl = `${process.env.NEXTAUTH_URL}/config?tab=billing&payment=error`;
    return NextResponse.redirect(redirectUrl);
  }
}

/**
 * Handle GET requests (in case Tilopay uses GET redirect)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const data = Object.fromEntries(searchParams.entries());
  
  // Process same as POST
  return POST(request);
}

