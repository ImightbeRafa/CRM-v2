import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateApiKey, updateApiKeyLastUsed } from '@/lib/integration-auth';
import { createExternalOrder, checkDuplicateOrder } from '@/lib/integration-orders';
import { logIntegrationActivity } from '@/lib/integration-logs';

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
  try {
    // Extract and validate API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Missing API key. Include x-api-key header.' },
        { status: 401 }
      );
    }

    // Validate API key and get tenant
    const tenantId = await validateApiKey(apiKey);
    if (!tenantId) {
      await logIntegrationActivity(null, 'INVALID_API_KEY', { apiKey: apiKey.substring(0, 8) + '...' });
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    const validationResult = ExternalOrderSchema.safeParse(body);
    
    if (!validationResult.success) {
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

    const orderData = validationResult.data;

    // Check for duplicate order ID
    const existingOrder = await checkDuplicateOrder(tenantId, orderData.orderId);
    if (existingOrder) {
      await logIntegrationActivity(tenantId, 'DUPLICATE_ORDER', { orderId: orderData.orderId });
      return NextResponse.json(
        { 
          error: 'Order already exists',
          orderId: orderData.orderId
        },
        { status: 409 }
      );
    }

    // Create the order in the CRM
    const createdOrder = await createExternalOrder(tenantId, orderData);

    // Log successful integration
    await logIntegrationActivity(tenantId, 'ORDER_CREATED', {
      orderId: orderData.orderId,
      source: orderData.source,
      crmOrderId: createdOrder.id
    });

    // Update API key last used timestamp
    await updateApiKeyLastUsed(apiKey);

    return NextResponse.json({
      success: true,
      message: 'Order created successfully',
      crmOrderId: createdOrder.id,
      orderId: orderData.orderId
    });

  } catch (error) {
    console.error('Integration API error:', error);
    
    // Log error - use validateApiKey to get tenantId
    const apiKey = req.headers.get('x-api-key') || '';
    const tenantId = await validateApiKey(apiKey).catch(() => null);
    await logIntegrationActivity(tenantId, 'API_ERROR', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
