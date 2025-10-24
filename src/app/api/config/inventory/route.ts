import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const tenantId = user.memberships[0].tenantId;

    const inventory = await prisma.inventoryItem.findMany({
      where: { 
        isActive: true,
        tenantId 
      },
      orderBy: [
        { isFavorite: 'desc' },
        { name: 'asc' }
      ]
    });

    return NextResponse.json({
      status: 'success',
      data: inventory
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch inventory' },
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

    // Get user with memberships to find tenant ID and role
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const membership = user.memberships[0];
    const tenantId = membership.tenantId;

    // Check if user is MASTER
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      category,
      sku,
      currentStock,
      minStock,
      maxStock,
      unitCost,
      sellingPrice,
      supplier,
      location,
      reorderPoint,
      reorderQuantity,
      isFavorite
    } = body;

    // Check if SKU already exists
    const existingItem = await prisma.inventoryItem.findFirst({
      where: { 
        sku, 
        isActive: true,
        tenantId 
      }
    });

    if (existingItem) {
      return NextResponse.json(
        { error: 'SKU already exists' },
        { status: 400 }
      );
    }

    const inventoryItem = await prisma.inventoryItem.create({
      data: {
        name,
        description,
        category,
        sku,
        currentStock: parseInt(currentStock) || 0,
        minStock: parseInt(minStock) || 0,
        maxStock: maxStock ? parseInt(maxStock) : null,
        unitCost: parseFloat(unitCost) || 0,
        sellingPrice: parseFloat(sellingPrice) || 0,
        supplier,
        location,
        reorderPoint: parseInt(reorderPoint) || 0,
        reorderQuantity: parseInt(reorderQuantity) || 0,
        isFavorite: isFavorite || false,
        isActive: true,
        createdBy: token.sub as string,
        tenant: { connect: { id: tenantId } }
      }
    });

    return NextResponse.json({
      status: 'success',
      data: inventoryItem
    });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to create inventory item' },
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

    // Get user with memberships to find tenant ID and role
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const membership = user.memberships[0];
    const tenantId = membership.tenantId;

    // Check if user is MASTER
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const {
      id,
      name,
      description,
      category,
      sku,
      currentStock,
      minStock,
      maxStock,
      unitCost,
      sellingPrice,
      supplier,
      location,
      reorderPoint,
      reorderQuantity,
      isFavorite
    } = body;

    // Check if SKU already exists for different item in same tenant
    const existingItem = await prisma.inventoryItem.findFirst({
      where: { 
        sku, 
        isActive: true,
        tenantId,
        id: { not: id }
      }
    });

    if (existingItem) {
      return NextResponse.json(
        { error: 'SKU already exists' },
        { status: 400 }
      );
    }

    const inventoryItem = await prisma.inventoryItem.update({
      where: { id },
      data: {
        name,
        description,
        category,
        sku,
        currentStock: parseInt(currentStock) || 0,
        minStock: parseInt(minStock) || 0,
        maxStock: maxStock ? parseInt(maxStock) : null,
        unitCost: parseFloat(unitCost) || 0,
        sellingPrice: parseFloat(sellingPrice) || 0,
        supplier,
        location,
        reorderPoint: parseInt(reorderPoint) || 0,
        reorderQuantity: parseInt(reorderQuantity) || 0,
        isFavorite,
        lastUpdated: new Date()
      }
    });

    return NextResponse.json({
      status: 'success',
      data: inventoryItem
    });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to update inventory item' },
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

    // Get user with memberships to find tenant ID and role
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    });

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const membership = user.memberships[0];
    const tenantId = membership.tenantId;

    // Check if user is MASTER
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
    }

    // Verify item belongs to tenant before deleting
    const item = await prisma.inventoryItem.findFirst({
      where: { id, tenantId }
    });

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    await prisma.inventoryItem.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Inventory item deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to delete inventory item' },
      { status: 500 }
    );
  }
}
