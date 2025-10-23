import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';
import bcrypt from 'bcryptjs';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).membershipRole !== 'OWNER' && (token as any).membershipRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const configs = await prisma.shippingConfig.findMany({
      where: { isActive: true, tenantId },
      orderBy: { name: 'asc' }
    });

    // Remove sensitive data from response
    const safeConfigs = configs.map(config => ({
      ...config,
      password: config.password ? '***' : null
    }));

    return NextResponse.json({
      status: 'success',
      data: safeConfigs
    });
  } catch (error) {
    console.error('Error loading shipping configs:', error);
    return NextResponse.json(
      { error: 'Failed to load shipping configurations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).membershipRole !== 'OWNER' && (token as any).membershipRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      carrier,
      name,
      email,
      password,
      apiKey,
      baseUrl,
      isDefault,
      settings
    } = body;

    // Validate required fields
    if (!carrier || !name) {
      return NextResponse.json(
        { error: 'Carrier and name are required' },
        { status: 400 }
      );
    }

    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // If this is set as default, unset other defaults in same tenant
    if (isDefault) {
      await prisma.shippingConfig.updateMany({
        where: { isDefault: true, tenantId },
        data: { isDefault: false }
      });
    }

    // Encrypt password if provided
    let encryptedPassword = null;
    if (password && password !== '***') {
      encryptedPassword = await bcrypt.hash(password, 12);
    }

    const shippingConfig = await prisma.shippingConfig.create({
      data: {
        carrier,
        name,
        email,
        password: encryptedPassword,
        apiKey,
        baseUrl,
        isDefault,
        settings: settings || null,
        tenant: { connect: { id: tenantId } }
      }
    });

    return NextResponse.json({
      status: 'success',
      data: {
        ...shippingConfig,
        password: shippingConfig.password ? '***' : null
      }
    });
  } catch (error) {
    console.error('Error creating shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to create shipping configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).membershipRole !== 'OWNER' && (token as any).membershipRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      id,
      carrier,
      name,
      email,
      password,
      apiKey,
      baseUrl,
      isDefault,
      settings
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    // If this is set as default, unset other defaults in same tenant
    if (isDefault) {
      await prisma.shippingConfig.updateMany({
        where: { 
          isDefault: true,
          tenantId,
          id: { not: id }
        },
        data: { isDefault: false }
      });
    }

    // Handle password update
    let encryptedPassword = undefined;
    if (password && password !== '***') {
      encryptedPassword = await bcrypt.hash(password, 12);
    }

    const updateData: any = {
      carrier,
      name,
      email,
      apiKey,
      baseUrl,
      isDefault,
      settings: settings || null,
      updatedAt: new Date()
    };

    // Only update password if a new one is provided
    if (encryptedPassword !== undefined) {
      updateData.password = encryptedPassword;
    }

    const shippingConfig = await prisma.shippingConfig.update({
      where: { id },
      data: updateData
    });

    return NextResponse.json({
      status: 'success',
      data: {
        ...shippingConfig,
        password: shippingConfig.password ? '***' : null
      }
    });
  } catch (error) {
    console.error('Error updating shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to update shipping configuration' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is MASTER
    if ((token as any).membershipRole !== 'OWNER' && (token as any).membershipRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'ID is required' },
        { status: 400 }
      );
    }

    // Verify ownership before deleting
    const config = await prisma.shippingConfig.findFirst({
      where: { id, tenantId }
    });

    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }

    // Soft delete by setting isActive to false
    await prisma.shippingConfig.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Shipping configuration deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting shipping config:', error);
    return NextResponse.json(
      { error: 'Failed to delete shipping configuration' },
      { status: 500 }
    );
  }
}
