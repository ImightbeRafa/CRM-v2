import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { withTenantContext } from '@/lib/tenantContext';
import { CorreosAutomation, convertOrderToCorreosFormat } from '@/lib/correosAutomation';
import fs from 'fs';
import path from 'path';

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
      return NextResponse.json(
        { error: 'Order IDs are required' },
        { status: 400 }
      );
    }

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId)
      
      // Validate shipping configuration exists
      const shippingConfig = await prisma.shippingConfig.findFirst({
        where: { 
          carrier,
          isActive: true,
          tenantId: tenantId
        }
      });

      if (!shippingConfig || !shippingConfig.email || !shippingConfig.password) {
        return NextResponse.json(
          { error: 'Shipping configuration is incomplete' },
          { status: 400 }
        );
      }

      // Sender information no longer required; Correos pre-fills remitente

      // Get orders
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

      // Initialize automation (only credentials required)
      // Password is stored in plain text for automation
      const automation = new CorreosAutomation({
        email: shippingConfig.email,
        password: shippingConfig.password
      });

      // Convert orders to Correos format
      const ordersData = orders.map(order => convertOrderToCorreosFormat(order, deliveryType));

      // Generate guías
      const results = await automation.generateMultipleGuias(ordersData);

      // Save guía records (without PDF storage)
      const savedGuias = [];

      for (const result of results) {
        if (result.success && result.guiaNumber) {
          try {
            // Save to database with PDF if available
            const guiaData: any = {
              orderId: result.orderId,
              carrier: carrier,
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber,
              status: 'completed',
              serviceType: 'standard',
              tenant: { connect: { id: tenantId } }
            };

            // Add PDF data if available (normalize to Node Buffer)
            if (result.pdfBuffer && result.pdfFileName) {
              const asAny: any = result.pdfBuffer as any;
              const normalizedBuffer = Buffer.isBuffer(result.pdfBuffer)
                ? result.pdfBuffer
                : (asAny && Array.isArray(asAny.data))
                  ? Buffer.from(asAny.data)
                  : (asAny instanceof Uint8Array)
                    ? Buffer.from(asAny)
                    : undefined;

              if (normalizedBuffer) {
                guiaData.pdfData = normalizedBuffer;
                guiaData.pdfFileName = result.pdfFileName;
                console.log(`✓ Saving PDF to database: ${result.pdfFileName} (${normalizedBuffer.length} bytes)`);
              } else {
                console.warn('Skipping PDF save: pdfBuffer not a Buffer/Uint8Array or { data: number[] } object');
              }
            }

            const guia = await prisma.shippingGuia.create({
              data: guiaData
            });
            savedGuias.push(guia);

            // Update order status
            await prisma.order.update({
              where: {
                tenantId_orderId: {
                  tenantId: tenantId,
                  orderId: result.orderId
                }
              },
              data: {
                status: 'Enviado',
                courier: carrier,
                tenantId: tenantId
              }
            });
          } catch (error) {
            console.error(`Failed to save guía for order ${result.orderId}:`, error);
          }
        } else {
          // Failed guía - persist placeholder so it appears in history
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

      return NextResponse.json({
        status: 'success',
        data: {
          results,
          savedGuias: savedGuias.map(g => ({
            id: g.id,
            orderId: g.orderId,
            guiaNumber: g.guiaNumber,
            hasPdf: false
          })),
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length
        }
      });
    });
  } catch (error) {
    console.error('Error generating guías:', error);
    return NextResponse.json(
      { error: 'Failed to generate guías' },
      { status: 500 }
    );
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
