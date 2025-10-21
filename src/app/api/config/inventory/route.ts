import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const inventory = await prisma.inventoryItem.findMany({
      where: { isActive: true },
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

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
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
      where: { sku, isActive: true }
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
        currentStock,
        minStock,
        maxStock,
        unitCost,
        sellingPrice,
        supplier,
        location,
        reorderPoint,
        reorderQuantity,
        isFavorite: isFavorite || false,
        isActive: true,
        createdBy: token.sub as string
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

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
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

    // Check if SKU already exists for different item
    const existingItem = await prisma.inventoryItem.findFirst({
      where: { 
        sku, 
        isActive: true,
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
        currentStock,
        minStock,
        maxStock,
        unitCost,
        sellingPrice,
        supplier,
        location,
        reorderPoint,
        reorderQuantity,
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

    // Check if user is MASTER
    if ((token as any).role !== 'MASTER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
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
