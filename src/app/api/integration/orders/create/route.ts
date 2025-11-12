import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, updateApiKeyLastUsed } from '@/lib/integration-auth';
import { createExternalOrder, checkDuplicateOrder } from '@/lib/integration-orders';
import { logIntegrationActivity } from '@/lib/integration-logs';

// Configure route for Vercel deployment
export const maxDuration = 30; // Maximum execution time in seconds
export const dynamic = 'force-dynamic'; // Disable static optimization

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
  metadata: z.record(z.any()).optional(),
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let tenantId: string | null = null;
  
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
      await logIntegrationActivity(null, 'INVALID_API_KEY', { apiKey: apiKey.substring(0, 8) + '...' });
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }
    console.log(`[Integration API] Tenant validated: ${tenantId}`);

    // Parse and validate request body
    console.log('[Integration API] Parsing request body...');
    const body = await req.json();
    console.log(`[Integration API] Order ID: ${body.orderId}`);
    const validationResult = ExternalOrderSchema.safeParse(body);
    
    if (!validationResult.success) {
      console.error('[Integration API] Validation failed:', validationResult.error.errors);
      await logIntegrationActivity(tenantId, 'VALIDATION_ERROR', {
        errors: validationResult.error.errors,
        body: body
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
    console.log('[Integration API] Checking for duplicates...');
    const existingOrder = await checkDuplicateOrder(tenantId, orderData.orderId);
    if (existingOrder) {
      console.log(`[Integration API] Duplicate order found: ${orderData.orderId}`);
      await logIntegrationActivity(tenantId, 'DUPLICATE_ORDER', { orderId: orderData.orderId });
      return NextResponse.json(
        { 
          error: 'Order already exists',
          orderId: orderData.orderId
        },
        { status: 409 }
      );
    }
    console.log('[Integration API] No duplicate found');

    // Create the order in the CRM
    console.log('[Integration API] Creating order in CRM...');
    const createdOrder = await createExternalOrder(tenantId, orderData);
    console.log(`[Integration API] Order created with ID: ${createdOrder.id}`);

    // Log successful integration
    await logIntegrationActivity(tenantId, 'ORDER_CREATED', {
      orderId: orderData.orderId,
      source: orderData.source,
      crmOrderId: createdOrder.id,
      processingTime: Date.now() - startTime
    });

    // Update API key last used timestamp (non-blocking)
    updateApiKeyLastUsed(apiKey).catch(err => 
      console.error('[Integration API] Failed to update API key last used:', err)
    );

    const processingTime = Date.now() - startTime;
    console.log(`[Integration API] Success! Total time: ${processingTime}ms`);
    
    return NextResponse.json({
      success: true,
      message: 'Order created successfully',
      crmOrderId: createdOrder.id,
      orderId: orderData.orderId,
      processingTime
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('[Integration API] Error after', processingTime, 'ms:', error);
    
    // Log error with detailed information
    try {
      await logIntegrationActivity(tenantId, 'API_ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        processingTime,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
    } catch (logError) {
      console.error('[Integration API] Failed to log error:', logError);
    }

    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      },
      { status: 500 }
    );
  }
}
