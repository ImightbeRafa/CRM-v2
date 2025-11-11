import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { getToken } from 'next-auth/jwt';
import { CorreosAutomation, convertOrderToCorreosFormat } from '@/lib/correosAutomation';
import bcrypt from 'bcryptjs';
import { withTenantContext } from '@/lib/tenantContext';

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
    const { orderIds, carrier = 'correos_cr' } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: 'Order IDs are required' },
        { status: 400 }
      );
    }

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId)
      
      // Get shipping configuration
      const shippingConfig = await prisma.shippingConfig.findFirst({
        where: { 
          carrier,
          isActive: true,
          tenantId: tenantId
        }
      });

      if (!shippingConfig) {
        return NextResponse.json(
          { error: `No active configuration found for carrier: ${carrier}` },
          { status: 404 }
        );
      }

      if (!shippingConfig.email || !shippingConfig.password) {
        return NextResponse.json(
          { error: 'Shipping configuration is incomplete' },
          { status: 400 }
        );
      }

      // Get orders data
      const orders = await prisma.order.findMany({
        where: {
          orderId: { in: orderIds },
          orderType: 'EA', // Only EA orders can be shipped
          tenantId: tenantId
        }
      });

      if (orders.length === 0) {
        return NextResponse.json(
          { error: 'No valid orders found for shipping' },
          { status: 404 }
        );
      }

      // Decrypt password
      const decryptedPassword = await bcrypt.compare('temp', shippingConfig.password) 
        ? shippingConfig.password 
        : shippingConfig.password; // In production, implement proper decryption

      // Initialize automation
      const automation = new CorreosAutomation({
        email: shippingConfig.email,
        password: decryptedPassword
      });

      // Convert orders to Correos format
      const ordersData = orders.map(convertOrderToCorreosFormat);

      // Generate guías
      const results = await automation.generateMultipleGuias(ordersData);

      // Save guía records to database
      const savedGuias = [];
      for (const result of results) {
        if (result.success && result.guiaNumber) {
          try {
            const guia = await prisma.shippingGuia.create({
            data: {
              orderId: result.orderId,
              carrier: carrier,
              guiaNumber: result.guiaNumber,
              trackingNumber: result.trackingNumber,
              status: 'created',
              serviceType: 'standard',
              tenantId: tenantId
            }
          });
            savedGuias.push(guia);
          } catch (error) {
            console.error(`Failed to save guía for order ${result.orderId}:`, error);
          }
        }
      }

      // Update order status to "Enviado" for successful guías
      const successfulOrderIds = results
        .filter(r => r.success)
        .map(r => r.orderId);

      if (successfulOrderIds.length > 0) {
        await prisma.order.updateMany({
          where: {
            orderId: { in: successfulOrderIds },
            tenantId: tenantId
          },
          data: {
            status: 'Enviado',
            courier: carrier
          }
        });
      }

      return NextResponse.json({
        status: 'success',
        data: {
          results,
          savedGuias,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          pdfsDownloaded: results.filter(r => r.success && r.pdfDownloaded).length
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
