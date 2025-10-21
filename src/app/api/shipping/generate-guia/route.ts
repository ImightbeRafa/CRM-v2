import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';
import { CorreosAutomation, convertOrderToCorreosFormat } from '@/lib/correosAutomation';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { orderIds, carrier = 'correos_cr' } = body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return NextResponse.json(
        { error: 'Order IDs are required' },
        { status: 400 }
      );
    }

    // Get shipping configuration
    const shippingConfig = await prisma.shippingConfig.findFirst({
      where: { 
        carrier,
        isActive: true 
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
        orderType: 'EA' // Only EA orders can be shipped
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
              serviceType: 'standard'
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
          orderId: { in: successfulOrderIds }
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

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('orderId');

    if (orderId) {
      // Get guía for specific order
      const guia = await prisma.shippingGuia.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' }
      });

      return NextResponse.json({
        status: 'success',
        data: guia
      });
    } else {
      // Get all guías
      const guias = await prisma.shippingGuia.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100
      });

      return NextResponse.json({
        status: 'success',
        data: guias
      });
    }

  } catch (error) {
    console.error('Error fetching guías:', error);
    return NextResponse.json(
      { error: 'Failed to fetch guías' },
      { status: 500 }
    );
  }
}
