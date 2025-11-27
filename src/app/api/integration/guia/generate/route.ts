import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/integration-auth';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { CorreosAutomation, convertOrderToCorreosFormat } from '@/lib/correosAutomation';
import { logIntegrationActivity } from '@/lib/integration-logs';

// Configure route for Vercel deployment
export const maxDuration = 300; // 5 minutes for guia generation
export const dynamic = 'force-dynamic';

/**
 * POST /api/integration/guia/generate
 * 
 * Headless guia generation endpoint for Correos de Costa Rica
 * 
 * Headers:
 *   x-api-key: Your API key
 * 
 * Body:
 *   {
 *     "orderIds": ["ORDER-123", "ORDER-456"],
 *     "carrier": "correos_cr",
 *     "deliveryType": "Domicilio" | "Sucursal" | "Punto de correo"
 *   }
 * 
 * Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "results": [
 *         {
 *           "success": true,
 *           "orderId": "ORDER-123",
 *           "guiaNumber": "PY05869748CR",
 *           "trackingNumber": "PY05869748CR"
 *         }
 *       ],
 *       "successful": 1,
 *       "failed": 0
 *     }
 *   }
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();
  let tenantId: string | null = null;
  
  try {
    // Extract and validate API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      console.error('[Guia API] Missing API key');
      return NextResponse.json(
        { error: 'Missing API key. Include x-api-key header.' },
        { status: 401 }
      );
    }

    console.log('[Guia API] Validating API key...');
    // Validate API key and get tenant
    tenantId = await validateApiKey(apiKey);
    if (!tenantId) {
      console.error('[Guia API] Invalid API key');
      await logIntegrationActivity(null, 'INVALID_API_KEY', { apiKey: apiKey.substring(0, 8) + '...' });
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      );
    }
    console.log(`[Guia API] Tenant validated: ${tenantId}`);

    // Parse request body
    const body = await req.json();
    const { orderIds, carrier = 'correos_cr', deliveryType = 'Domicilio' } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: 'orderIds array is required' },
        { status: 400 }
      );
    }

    if (!['Domicilio', 'Sucursal', 'Punto de correo'].includes(deliveryType)) {
      return NextResponse.json(
        { error: 'Invalid deliveryType. Must be one of: Domicilio, Sucursal, Punto de correo' },
        { status: 400 }
      );
    }

    console.log(`[Guia API] Generating guías for ${orderIds.length} orders`);

    return await withTenantContext({ tenantId, userId: 'system', role: 'SYSTEM', userRole: 'SYSTEM', userName: 'API' }, async () => {
      // SECURITY: Always use tenant-isolated client
      const prisma = getTenantPrisma(tenantId);
      
      // Validate shipping configuration exists
      const shippingConfig = await prisma.shippingConfig.findFirst({
        where: { 
          carrier,
          isActive: true,
          tenantId: tenantId
        }
      });

      if (!shippingConfig || !shippingConfig.email || !shippingConfig.password) {
        await logIntegrationActivity(tenantId, 'GUIA_GENERATION_FAILED', {
          error: 'Shipping configuration incomplete',
          orderIds
        });
        return NextResponse.json(
          { error: 'Shipping configuration is incomplete. Please configure Correos de Costa Rica credentials in settings.' },
          { status: 400 }
        );
      }

      // Get orders (tenant-isolated automatically)
      const orders = await prisma.order.findMany({
        where: {
          orderId: { in: orderIds },
          orderType: 'EA',
          tenantId: tenantId
        }
      });

      if (orders.length === 0) {
        return NextResponse.json(
          { error: 'No valid orders found for shipping' },
          { status: 404 }
        );
      }

      if (orders.length !== orderIds.length) {
        console.warn(`[Guia API] Only found ${orders.length} of ${orderIds.length} requested orders`);
      }

      // Initialize automation (headless mode enforced in production)
      const automation = new CorreosAutomation({
        email: shippingConfig.email,
        password: shippingConfig.password
      });

      // Convert orders to Correos format
      const ordersData = orders.map(order => convertOrderToCorreosFormat(order, deliveryType));

      // Generate guías (headless, no popups)
      console.log(`[Guia API] Starting headless guia generation for ${ordersData.length} orders...`);
      const results = await automation.generateMultipleGuias(ordersData);

      // Save guía records
      const savedGuias = [];

      for (const result of results) {
        if (result.success && result.guiaNumber) {
          try {
            const guiaData: any = {
              orderId: result.orderId,
              carrier: carrier,
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber,
              status: 'completed',
              serviceType: 'standard',
              tenant: { connect: { id: tenantId } }
            };

            // Add PDF data if available
            if (result.pdfBuffer && result.pdfFileName) {
              const normalizedBuffer = Buffer.isBuffer(result.pdfBuffer)
                ? result.pdfBuffer
                : Buffer.from(result.pdfBuffer as any);
              
              if (normalizedBuffer) {
                guiaData.pdfData = normalizedBuffer;
                guiaData.pdfFileName = result.pdfFileName;
              }
            }

            const guia = await prisma.shippingGuia.create({
              data: guiaData
            });
            savedGuias.push(guia);

            // Update order status
            try {
              await prisma.order.update({
                where: {
                  tenantId_orderId: {
                    tenantId: tenantId,
                    orderId: result.orderId
                  }
                },
                data: {
                  status: 'Enviado',
                  courier: carrier
                }
              });
            } catch (updateError) {
              console.error(`[Guia API] Failed to update order ${result.orderId}:`, updateError);
            }
          } catch (error) {
            console.error(`[Guia API] Failed to save guía for order ${result.orderId}:`, error);
          }
        } else {
          // Failed guía - persist placeholder
          await prisma.shippingGuia.create({
            data: {
              orderId: result.orderId,
              carrier: carrier,
              guiaNumber: `PENDING-${result.orderId}`,
              trackingNumber: null,
              status: 'failed',
              serviceType: 'standard',
              tenant: { connect: { id: tenantId } }
            }
          });
        }
      }

      // Log successful integration
      await logIntegrationActivity(tenantId, 'GUIA_GENERATED', {
        orderIds,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        processingTime: Date.now() - startTime
      });

      const processingTime = Date.now() - startTime;
      console.log(`[Guia API] Success! Total time: ${processingTime}ms`);

      return NextResponse.json({
        success: true,
        message: 'Guías generated successfully',
        data: {
          results: results.map(r => ({
            success: r.success,
            orderId: r.orderId,
            guiaNumber: r.guiaNumber,
            trackingNumber: r.trackingNumber,
            error: r.error,
            pdfDownloaded: r.pdfDownloaded || false
          })),
          savedGuias: savedGuias.map(g => ({
            id: g.id,
            orderId: g.orderId,
            guiaNumber: g.guiaNumber,
            hasPdf: !!g.pdfData
          })),
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        },
        processingTime
      });
    });
  } catch (error: any) {
    const processingTime = Date.now() - startTime;
    console.error('[Guia API] Error:', error);
    
    if (tenantId) {
      await logIntegrationActivity(tenantId, 'GUIA_GENERATION_ERROR', {
        error: error.message,
        processingTime
      }).catch(() => {});
    }
    
    return NextResponse.json(
      { 
        error: 'Failed to generate guías',
        message: error.message || 'Unknown error',
        processingTime
      },
      { status: 500 }
    );
  }
}

