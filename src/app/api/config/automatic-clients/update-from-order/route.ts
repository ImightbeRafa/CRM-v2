import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = (token as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const body = await request.json();
    const {
      customerId, // If provided, update this specific customer
      name,
      phone,
      email,
      province,
      canton,
      district,
      address,
      business,
      username
    } = body;

    // Validate required fields
    if (!phone || !name) {
      return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 });
    }

    let existingClient = null;

    // If a specific customer ID was provided, use that
    if (customerId) {
      existingClient = await prisma.client.findFirst({
        where: { 
          id: customerId, 
          isActive: true, 
          tenantId 
        }
      });
    }

    // Otherwise, check if client exists with this phone number
    if (!existingClient) {
      existingClient = await prisma.client.findFirst({
        where: { 
          phone, 
          isActive: true, 
          tenantId 
        }
      });
    }

    if (existingClient) {
      // UPDATE existing client with new information
      const updatedClient = await prisma.client.update({
        where: { id: existingClient.id },
        data: {
          name,
          email: email || existingClient.email,
          province,
          canton,
          district,
          address: address || existingClient.address,
          business: business || existingClient.business,
          username: username || existingClient.username,
          lastUpdated: new Date()
        }
      });

      return NextResponse.json({
        status: 'success',
        action: 'updated',
        data: updatedClient
      });
    } else {
      // CREATE new client
      const newClient = await prisma.client.create({
        data: {
          name,
          phone,
          email: email || '',
          province,
          canton,
          district,
          address: address || '',
          business: business || '',
          username: username || '',
          totalOrders: 0,
          totalSpent: 0,
          averageOrderValue: 0,
          firstOrder: new Date(),
          lastOrder: new Date(),
          isActive: true,
          isFavorite: false,
          createdBy: token.sub as string,
          tenant: { connect: { id: tenantId } }
        }
      });

      return NextResponse.json({
        status: 'success',
        action: 'created',
        data: newClient
      });
    }
  } catch (error) {
    console.error('Error updating client from order:', error);
    return NextResponse.json(
      { error: 'Failed to update client' },
      { status: 500 }
    );
  }
}

