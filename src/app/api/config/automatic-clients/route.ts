import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { normalizeClientEmail, normalizeClientPhone } from '@/lib/order-lifecycle';

export async function GET(request: NextRequest) {
  try {
    // Require 'view_sales' permission
    const auth = await authenticateAPIWithPermission(request, 'view_sales');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const clients = await prisma.client.findMany({
      where: { isActive: true },
      orderBy: [
        { isFavorite: 'desc' },
        { totalSpent: 'desc' },
        { name: 'asc' }
      ]
    });
    
    // Security logging - verify all clients belong to this tenant
    if (process.env.NODE_ENV !== 'production') {
      const wrongTenantClients = clients.filter((c: any) => c.tenantId !== tenantId);
      if (wrongTenantClients.length > 0) {
        console.error('🚨 TENANT ISOLATION BREACH in /api/config/automatic-clients:', {
          requestedTenant: tenantId,
          breachedClients: wrongTenantClients.map((c: any) => ({ 
            id: c.id, 
            name: c.name,
            tenantId: c.tenantId 
          }))
        });
      }
    }

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
    // Require 'update_sales' permission
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId } = auth;
    const prisma = getTenantPrisma(tenantId);

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

    // Check if client already exists by phone (auto-filtered by tenantPrisma)
    const normalizedPhone = normalizeClientPhone(phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Valid phone number is required' }, { status: 400 });
    }
    const existingClient = await prisma.client.findFirst({
      where: { OR: [{ normalizedPhone }, { phone }], isActive: true }
    });

    if (existingClient) {
      return NextResponse.json(
        { error: 'Client with this phone number already exists' },
        { status: 400 }
      );
    }

    const client = await prisma.client.create({
      data: {
        tenantId,
        name,
        phone,
        email,
        normalizedPhone,
        normalizedEmail: normalizeClientEmail(email),
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
        createdBy: userId
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
    // Require 'update_sales' permission
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

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

    // Check if phone already exists for different client (auto-filtered by tenantPrisma)
    const normalizedPhone = normalizeClientPhone(phone);
    if (!normalizedPhone) {
      return NextResponse.json({ error: 'Valid phone number is required' }, { status: 400 });
    }
    const existingClient = await prisma.client.findFirst({
      where: { 
        OR: [{ normalizedPhone }, { phone }],
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
        normalizedPhone,
        normalizedEmail: normalizeClientEmail(email),
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
    // Require 'update_sales' permission
    const auth = await authenticateAPIWithPermission(request, 'update_sales');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Client ID is required' }, { status: 400 });
    }

    // CRITICAL: Soft delete with tenant isolation (auto-verified by tenantPrisma)
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
