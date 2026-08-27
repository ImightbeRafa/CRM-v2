import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { validateApiKey, updateApiKeyLastUsed, hashApiKey } from '@/lib/integration-auth';
import { countRecentExternalOrders, createExternalOrder, findExternalOrderByOrderId } from '@/lib/integration-orders';
import { logIntegrationActivity } from '@/lib/integration-logs';
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit';
import { evaluateTenantAccess, markRestrictedBacklog, type TenantAccessEvaluation } from '@/lib/billing-access';

// Configure route for Vercel deployment
export const maxDuration = 30; // Maximum execution time in seconds
export const dynamic = 'force-dynamic'; // Disable static optimization

const websiteIntakeRateLimit = createIdentifierRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 120,
  identifier: 'website-order-intake',
});

// Validation schema for external order data
const ExternalOrderSchema = z.object({
  orderId: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().email(),
  }),
  product: z.object({
    name: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.string().min(1),
  }),
  shipping: z.object({
    cost: z.string().min(1),
    courier: z.string().optional(),
    address: z.object({
      province: z.string().min(1),
      canton: z.string().min(1),
      district: z.string().min(1),
      fullAddress: z.string().min(1),
    }),
  }),
  total: z.string().min(1),
  payment: z.object({
    method: z.string().min(1),
    transactionId: z.string().min(1),
    status: z.string().min(1),
    date: z.string().min(1),
  }),
  source: z.string().optional(),
  salesChannel: z.string().optional(),
  seller: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let tenantId: string | null = null;
  let access: TenantAccessEvaluation | null = null;
  
  try {
    // Extract and validate API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      console.error('[Integration API] Missing API key');
      return NextResponse.json(
        { error: 'Missing API key. Include x-api-key header.' },
        { status: 401 }
      );
    }

    console.log('[Integration API] Validating API key...');
    // Validate API key and get tenant
    tenantId = await validateApiKey(apiKey);
    if (!tenantId) {
      console.error('[Integration API] Invalid API key');
      await logIntegrationActivity(null, 'INVALID_API_KEY', { provided: true });
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }
    const rate = await websiteIntakeRateLimit(`${tenantId}:${hashApiKey(apiKey)}:${getClientIP(req)}`);
    if (!rate.allowed) {
      return NextResponse.json({ error: 'Too many order requests' }, { status: 429, headers: rate.headers });
    }

    try {
      // Website intake is the sole regular-tenant write exception. We still
      // evaluate fresh DB state so restricted backlog can be marked accurately.
      access = await evaluateTenantAccess(tenantId);
    } catch (error) {
      console.error('[Integration API] Billing evaluation unavailable', {
        code: error instanceof Error ? error.name : 'evaluation_error',
      });
    }

    // Parse and validate request body
    console.log('[Integration API] Parsing request body...');
    const body = await req.json();
    const validationResult = ExternalOrderSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error('[Integration API] Validation failed:', validationResult.error.errors);
      await logIntegrationActivity(tenantId, 'VALIDATION_ERROR', {
        issueCount: validationResult.error.errors.length,
        issues: validationResult.error.errors.map(issue => ({ code: issue.code, path: issue.path })),
      });
      return NextResponse.json(
        { 
          error: 'Invalid order data',
          details: validationResult.error.errors
        },
        { status: 400 }
      );
    }
    console.log('[Integration API] Validation passed');

    const orderData = validationResult.data;

    // Check for duplicate order ID
    const existingOrder = await findExternalOrderByOrderId(tenantId, orderData.orderId);
    if (existingOrder) {
      return NextResponse.json({
        success: true,
        idempotentReplay: true,
        crmOrderId: existingOrder.id,
        orderId: existingOrder.orderId,
      });
    }
    const recentExternalOrders = await countRecentExternalOrders(
      tenantId,
      new Date(Date.now() - 15 * 60 * 1000),
    );
    if (recentExternalOrders >= 120) {
      return NextResponse.json({ error: 'Too many order requests' }, { status: 429, headers: rate.headers });
    }

    // Create the order in the CRM
    console.log('[Integration API] Creating order in CRM...');
    let createdOrder;
    try {
      createdOrder = await createExternalOrder(tenantId, orderData);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedOrder = await findExternalOrderByOrderId(tenantId, orderData.orderId);
        if (racedOrder) {
          return NextResponse.json({
            success: true,
            idempotentReplay: true,
            crmOrderId: racedOrder.id,
            orderId: racedOrder.orderId,
          });
        }
      }
      throw error;
    }
    // Log successful integration
    await logIntegrationActivity(tenantId, 'ORDER_CREATED', {
      source: orderData.source,
      processingTime: Date.now() - startTime
    });

    if (access?.wouldRestrict || access?.state === 'RESTRICTED') {
      try {
        await markRestrictedBacklog(tenantId, access);
      } catch (error) {
        console.error('[Integration API] Failed to mark restricted backlog', {
          code: error instanceof Error ? error.name : 'backlog_error',
        });
      }
    }

    // Update API key last used timestamp (non-blocking)
    updateApiKeyLastUsed(apiKey).catch(err => 
      console.error('[Integration API] Failed to update API key last used:', err)
    );

    const processingTime = Date.now() - startTime;
    return NextResponse.json({
      success: true,
      message: 'Order created successfully',
      crmOrderId: createdOrder.id,
      orderId: orderData.orderId,
      processingTime
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('[Integration API] Error after', processingTime, 'ms:', error instanceof Error ? error.name : 'unknown_error');
    
    // Log error with detailed information
    try {
      await logIntegrationActivity(tenantId, 'API_ERROR', {
        processingTime,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
    } catch (logError) {
      console.error('[Integration API] Failed to log error:', logError);
    }

    return NextResponse.json(
      { 
        error: 'Internal server error',
        processingTime
      },
      { status: 500 }
    );
  }
}
