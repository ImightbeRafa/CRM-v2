import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { prisma as globalPrisma } from '@/lib/db';
import { withTenantContext } from '@/lib/tenantContext';
import { CorreosWebService, buildGuiaDescription, buildFullAddress, getCorreosWSCredentials } from '@/lib/correos';

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
    const { orderIds, carrier = 'correos_cr', deliveryType = 'Domicilio', verifiedLocations } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json({ error: 'Order IDs are required' }, { status: 400 });
    }

    const locationMap = new Map<string, { province: string; canton: string; district: string; address: string }>();
    if (Array.isArray(verifiedLocations)) {
      for (const loc of verifiedLocations) {
        if (loc.orderId && loc.province && loc.canton && loc.district) {
          locationMap.set(loc.orderId, {
            province: String(loc.province),
            canton: String(loc.canton),
            district: String(loc.district),
            address: String(loc.address || ''),
          });
        }
      }
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

      let wsCreds;
      try {
        wsCreds = getCorreosWSCredentials();
      } catch (e: any) {
        return NextResponse.json(
          { error: e.message || 'Correos WS platform credentials not configured.' },
          { status: 400 }
        );
      }

      const orders = await prisma.order.findMany({
        where: { orderId: { in: orderIds }, orderType: 'EA' },
      });

      if (orders.length === 0) {
        return NextResponse.json({ error: 'No valid orders found for shipping' }, { status: 404 });
      }

      const sender = {
        name: settings.ws_sender_name || '',
        address: settings.ws_sender_address || '',
        zip: settings.ws_sender_zip || '10101',
        phone: settings.ws_sender_phone || '00000000',
      };

      const ws = new CorreosWebService(wsCreds);
      const results: { success: boolean; orderId: string; guiaNumber?: string; trackingNumber?: string; error?: string; pdfBuffer?: Buffer; pdfFileName?: string }[] = [];

      for (const order of orders) {
        try {
          const verified = locationMap.get(order.orderId);
          const province = verified?.province || order.province;
          const canton = verified?.canton || order.canton;
          const district = verified?.district || order.district;
          const address = verified?.address || order.address;

          let destZip = '10101';
          try {
            if (province && canton && district) {
              destZip = await ws.getPostalCode(province, canton, district);
              console.log(`[WS] Postal code for ${order.orderId}: ${province}/${canton}/${district} → ${destZip}`);
            }
          } catch (geoErr: any) {
            console.warn(`[WS] Could not resolve postal code for ${order.orderId}: ${geoErr.message}`);
          }

          const addressData = { province, canton, district, address };

          console.log(`[WS] Generating guía for ${order.orderId} (zip: ${destZip})...`);
          const res = await ws.generateAndRegisterGuia({
            customerName: order.customerName || 'Destinatario',
            customerPhone: order.phone || '00000000',
            customerAddress: buildFullAddress(addressData),
            customerZip: destZip,
            customerApartado: destZip,
            senderName: sender.name,
            senderAddress: sender.address,
            senderZip: sender.zip,
            senderPhone: sender.phone,
            weight: 500,
            description: buildGuiaDescription(order as any),
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

                // Upsert lm_orders so the order appears in the logistics tablero
                try {
                  const crmOrderId = (order as any).id;
                  if (crmOrderId) {
                    const existing = await globalPrisma.$queryRaw<{ id: string }[]>`
                      SELECT id FROM lm_orders WHERE crm_order_id = ${crmOrderId} LIMIT 1
                    `;
                    if (existing.length > 0) {
                      await globalPrisma.$executeRaw`
                        UPDATE lm_orders SET carrier = 'correos', status = 'Guía Creada', updated_at = NOW()
                        WHERE crm_order_id = ${crmOrderId}
                      `;
                    } else {
                      await globalPrisma.$executeRaw`
                        INSERT INTO lm_orders (crm_order_id, crm_tenant_id, carrier, status)
                        VALUES (${crmOrderId}, ${order.tenantId || tenantId}, 'correos', 'Guía Creada')
                      `;
                    }
                  }
                } catch (lmErr) {
                  console.warn(`[Generate Guía] Failed to upsert lm_orders for ${result.orderId}:`, lmErr);
                }
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
