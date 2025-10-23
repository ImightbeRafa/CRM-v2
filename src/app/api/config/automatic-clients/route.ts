import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clients = await prisma.client.findMany({
      where: { isActive: true },
      orderBy: [
        { isFavorite: 'desc' },
        { totalSpent: 'desc' },
        { name: 'asc' }
      ]
    });

    return NextResponse.json({
      status: 'success',
      data: clients
    });
  } catch (error) {
    console.error('Error fetching automatic clients:', error);
    return NextResponse.json(
      { error: 'Failed to fetch automatic clients' },
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
      name,
      phone,
      email,
      province,
      canton,
      district,
      address,
      business,
      username,
      notes,
      isFavorite
    } = body;

    // Check if client already exists by phone
    const existingClient = await prisma.client.findFirst({
      where: { phone, isActive: true }
    });

    if (existingClient) {
      return NextResponse.json(
        { error: 'Client with this phone number already exists' },
        { status: 400 }
      );
    }

    // Get tenant ID from token
    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const client = await prisma.client.create({
      data: {
        tenantId,
        name,
        phone,
        email,
        province,
        canton,
        district,
        address,
        business,
        username,
        notes,
        isFavorite: isFavorite || false,
        isActive: true,
        totalOrders: 0,
        totalSpent: 0,
        averageOrderValue: 0,
        firstOrder: new Date(),
        lastOrder: new Date(),
        createdBy: token.sub as string
      }
    });

    return NextResponse.json({
      status: 'success',
      data: client
    });
  } catch (error) {
    console.error('Error creating automatic client:', error);
    return NextResponse.json(
      { error: 'Failed to create automatic client' },
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
      name,
      phone,
      email,
      province,
      canton,
      district,
      address,
      business,
      username,
      notes,
      isFavorite
    } = body;

    // Check if phone already exists for different client
    const existingClient = await prisma.client.findFirst({
      where: { 
        phone, 
        isActive: true,
        id: { not: id }
      }
    });

    if (existingClient) {
      return NextResponse.json(
        { error: 'Phone number already exists for another client' },
        { status: 400 }
      );
    }

    const client = await prisma.client.update({
      where: { id },
      data: {
        name,
        phone,
        email,
        province,
        canton,
        district,
        address,
        business,
        username,
        notes,
        isFavorite,
        lastUpdated: new Date()
      }
    });

    return NextResponse.json({
      status: 'success',
      data: client
    });
  } catch (error) {
    console.error('Error updating automatic client:', error);
    return NextResponse.json(
      { error: 'Failed to update automatic client' },
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

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }

    await prisma.client.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Automatic client deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting automatic client:', error);
    return NextResponse.json(
      { error: 'Failed to delete automatic client' },
      { status: 500 }
    );
  }
}
