import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/integration-auth';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { withTenantContext } from '@/lib/tenantContext';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';
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

      const settings = (shippingConfig?.settings as Record<string, any>) ?? {};

      if (!settings.ws_username || !settings.ws_password) {
        await logIntegrationActivity(tenantId, 'GUIA_GENERATION_FAILED', {
          error: 'WS credentials not configured',
          orderIds
        });
        return NextResponse.json(
          { error: 'Correos Web Service credentials not configured. Please configure them in shipping settings.' },
          { status: 400 }
        );
      }

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

      const wsCreds: CorreosWSCredentials = {
        username: settings.ws_username,
        password: settings.ws_password,
        sistema: settings.ws_sistema || 'PYMEXPRESS',
        usuarioId: Number(settings.ws_usuario_id) || 0,
        servicioId: Number(settings.ws_servicio_id) || 0,
        codCliente: settings.ws_cod_cliente || '',
      };

      const sender = {
        name: settings.ws_sender_name || '',
        address: settings.ws_sender_address || '',
        zip: settings.ws_sender_zip || '10101',
        phone: settings.ws_sender_phone || '00000000',
      };

      const ws = new CorreosWebService(wsCreds);
      const results: { success: boolean; orderId: string; guiaNumber?: string; trackingNumber?: string; error?: string; pdfBuffer?: Buffer; pdfFileName?: string }[] = [];

      console.log(`[Guia API] Starting WS guia generation for ${orders.length} orders...`);

      for (const order of orders) {
        try {
          let destZip = '10101';
          try {
            if (order.province && order.canton && order.district) {
              destZip = await ws.getPostalCode(order.province, order.canton, order.district);
            }
          } catch (geoErr: any) {
            console.warn(`[Guia API] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
          }

          const res = await ws.generateAndRegisterGuia({
            customerName: order.customerName || 'Destinatario',
            customerPhone: order.phone || '00000000',
            customerAddress: order.address || 'Sin dirección',
            customerZip: destZip,
            customerApartado: destZip,
            senderName: sender.name,
            senderAddress: sender.address,
            senderZip: sender.zip,
            senderPhone: sender.phone,
            weight: 500,
            description: (order as any).product || (order as any).comments || 'Paquete',
          });

          results.push({
            success: res.success,
            orderId: order.orderId,
            guiaNumber: res.guiaNumber || undefined,
            trackingNumber: res.guiaNumber || undefined,
            error: res.error,
            pdfBuffer: res.pdfBuffer,
            pdfFileName: res.guiaNumber ? `guia-${res.guiaNumber}.pdf` : undefined,
          });
        } catch (err: any) {
          results.push({ success: false, orderId: order.orderId, error: err.message });
        }
      }

      const savedGuias = [];

      for (const result of results) {
        if (result.success && result.guiaNumber) {
          try {
            const guiaData: any = {
              orderId: result.orderId,
              carrier,
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber || result.guiaNumber,
              status: 'completed',
              serviceType: 'standard',
              tenant: { connect: { id: tenantId } }
            };

            if (result.pdfBuffer) {
              const buf = Buffer.isBuffer(result.pdfBuffer) ? result.pdfBuffer : Buffer.from(result.pdfBuffer as any);
              guiaData.pdfData = buf;
              guiaData.pdfFileName = result.pdfFileName || `guia-${result.guiaNumber}.pdf`;
            }

            const guia = await prisma.shippingGuia.create({ data: guiaData });
            savedGuias.push(guia);

            try {
              const order = orders.find(o => o.orderId === result.orderId);
              await prisma.order.update({
                where: { tenantId_orderId: { tenantId: tenantId, orderId: result.orderId } },
                data: { status: 'Enviado', courier: carrier }
              });

              if (order) {
                try {
                  await globalPrisma.$executeRaw`
                    INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                    VALUES (${(order as any).id}, ${tenantId}, 'correos', 'Guía Creada')
                    ON CONFLICT (crm_order_id) DO UPDATE
                    SET carrier = 'correos', status = 'Guía Creada', updated_at = NOW()
                  `;
                } catch (lmErr) {
                  console.warn(`[Guia API] Failed to upsert lm_orders for ${result.orderId}:`, lmErr);
                }
              }
            } catch (updateError) {
              console.error(`[Guia API] Failed to update order ${result.orderId}:`, updateError);
            }
          } catch (error) {
            console.error(`[Guia API] Failed to save guía for order ${result.orderId}:`, error);
          }
        } else {
          await prisma.shippingGuia.create({
            data: {
              orderId: result.orderId,
              carrier,
              guiaNumber: `PENDING-${result.orderId}`,
              status: 'failed',
              errorMessage: result.error || 'Failed to create guía',
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
            pdfDownloaded: !!r.pdfBuffer,
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
        processingTime
      },
      { status: 500 }
    );
  }
}

