import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { CorreosAutomation, convertOrderToCorreosFormat } from '@/lib/correosAutomation';
import { CorreosWebService } from '@/lib/correos';
import type { CorreosWSCredentials } from '@/lib/correos';

const DEFAULT_SENDER = {
  name: 'Pymexpress',
  address: 'San José, Costa Rica',
  zip: '10101',
  phone: '00000000',
};

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (token as any).tenantId as string;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    const userRole = (token as any)?.membershipRole;

    const body = await request.json();
    const { orderIds, carrier = 'correos_cr', deliveryType = 'Domicilio' } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: 'Order IDs are required' }, { status: 400 });
    }

    console.log(`[Generate Guía] Tenant ${tenantId}`, 'Generating guías for orders:', orderIds);

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);

      // Check for WS credentials in ShippingConfig.settings
      const shippingConfig = await prisma.shippingConfig.findFirst({
        where: { carrier, isActive: true, tenantId },
      });

      if (!shippingConfig) {
        return NextResponse.json({ error: 'Shipping configuration not found' }, { status: 400 });
      }

      const settings = (shippingConfig.settings as Record<string, any>) ?? {};
      const useWebService =
        settings.integrationMode === 'webservice' &&
        settings.ws_username &&
        settings.ws_password;

      const orders = await prisma.order.findMany({
        where: { orderId: { in: orderIds }, orderType: 'EA' },
      });

      if (orders.length === 0) {
        return NextResponse.json({ error: 'No valid orders found for shipping' }, { status: 404 });
      }

      let results: { success: boolean; orderId: string; guiaNumber?: string; trackingNumber?: string; error?: string; pdfBuffer?: Buffer; pdfFileName?: string }[];

      // ─── Web Service path ──────────────────────────────────────────
      if (useWebService) {
        const wsCreds: CorreosWSCredentials = {
          username: settings.ws_username,
          password: settings.ws_password,
          sistema: settings.ws_sistema || 'PYMEXPRESS',
          usuarioId: Number(settings.ws_usuario_id) || 0,
          servicioId: Number(settings.ws_servicio_id) || 0,
          codCliente: settings.ws_cod_cliente || '',
        };

        const ws = new CorreosWebService(wsCreds);
        results = [];

        for (const order of orders) {
          try {
            let destZip = '10101';
            try {
              if (order.province && order.canton && order.district) {
                destZip = await ws.getPostalCode(order.province, order.canton, order.district);
                console.log(`[WS] Postal code for ${order.orderId}: ${order.province}/${order.canton}/${order.district} → ${destZip}`);
              }
            } catch (geoErr: any) {
              console.warn(`[WS] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
            }

            console.log(`[WS] Generating guía for ${order.orderId} (zip: ${destZip})...`);
            const res = await ws.generateAndRegisterGuia({
              customerName: order.customerName || 'Destinatario',
              customerPhone: order.phone || '00000000',
              customerAddress: order.address || 'Sin dirección',
              customerZip: destZip,
              customerApartado: destZip,
              senderName: DEFAULT_SENDER.name,
              senderAddress: DEFAULT_SENDER.address,
              senderZip: DEFAULT_SENDER.zip,
              senderPhone: DEFAULT_SENDER.phone,
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
      } else {
        // ─── Browser automation path (legacy) ────────────────────────
        if (!shippingConfig.email || !shippingConfig.password) {
          return NextResponse.json({ error: 'Shipping configuration is incomplete' }, { status: 400 });
        }

        const automation = new CorreosAutomation({
          email: shippingConfig.email,
          password: shippingConfig.password,
        });

        const ordersData = orders.map((order) => convertOrderToCorreosFormat(order, deliveryType));
        const raw = await automation.generateMultipleGuias(ordersData);
        results = raw.map((r) => ({
          success: r.success,
          orderId: r.orderId,
          guiaNumber: r.guiaNumber,
          trackingNumber: r.trackingNumber,
          error: r.error,
          pdfBuffer: r.pdfBuffer,
          pdfFileName: r.pdfFileName,
        }));
      }

      // ─── Persist results ───────────────────────────────────────────
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
              tenant: { connect: { id: tenantId } },
            };

            if (result.pdfBuffer) {
              const buf = Buffer.isBuffer(result.pdfBuffer) ? result.pdfBuffer : Buffer.from(result.pdfBuffer as any);
              guiaData.pdfData = buf;
              guiaData.pdfFileName = result.pdfFileName || `guia-${result.guiaNumber}.pdf`;
            }

            const guia = await prisma.shippingGuia.create({ data: guiaData });
            savedGuias.push(guia);

            try {
              const order = orders.find((o) => o.orderId === result.orderId);
              if (order) {
                await prisma.order.update({
                  where: { tenantId_orderId: { tenantId: order.tenantId || tenantId, orderId: result.orderId } },
                  data: { status: 'Enviado', courier: carrier },
                });
              }
            } catch (updateError) {
              console.error(`Failed to update order ${result.orderId}:`, updateError);
            }
          } catch (error) {
            console.error(`Failed to save guía for order ${result.orderId}:`, error);
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
              tenant: { connect: { id: tenantId } },
            },
          });
        }
      }

      return NextResponse.json({
        status: 'success',
        data: {
          results: results.map((r) => ({
            success: r.success,
            orderId: r.orderId,
            guiaNumber: r.guiaNumber,
            error: r.error,
            pdfDownloaded: !!r.pdfBuffer,
          })),
          savedGuias: savedGuias.map((g) => ({ id: g.id, orderId: g.orderId, guiaNumber: g.guiaNumber, hasPdf: !!g.pdfData })),
          successful: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      });
    });
  } catch (error) {
    console.error('Error generating guías:', error);
    return NextResponse.json({ error: 'Failed to generate guías' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (token as any).tenantId as string;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const userId = (token as any)?.sub as string | undefined;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    const userRole = (token as any)?.membershipRole;

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      // SECURITY: Always use tenant-isolated client
      const prisma = getTenantPrisma(tenantId)
      
      if (orderId) {
        // Get guía for specific order
        const guia = await prisma.shippingGuia.findFirst({
          where: { 
            orderId,
            tenantId: tenantId
          },
          orderBy: { createdAt: 'desc' }
        });

        return NextResponse.json({
          status: 'success',
          data: guia
        });
      } else {
        // Get all guías
        const guias = await prisma.shippingGuia.findMany({
          where: {
            tenantId: tenantId
          },
          orderBy: { createdAt: 'desc' },
          take: 100
        });

        return NextResponse.json({
          status: 'success',
          data: guias
        });
      }
    });
  } catch (error) {
    console.error('Error fetching guías:', error);
    return NextResponse.json(
      { error: 'Failed to fetch guías' },
      { status: 500 }
    );
  }
}
