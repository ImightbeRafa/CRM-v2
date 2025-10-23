import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getToken } from 'next-auth/jwt';
import { logCreate, logUpdate, logDelete } from '@/lib/auditLogger';

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const frequentProducts = await prisma.inventoryItem.findMany({
      where: { isActive: true },
      orderBy: [
        { isFavorite: 'desc' },
        { totalSold: 'desc' },
        { lastSold: 'desc' }
      ]
    });

    return NextResponse.json({
      status: 'success',
      data: frequentProducts
    });
  } catch (error) {
    console.error('Error fetching frequent products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch frequent products' },
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
    const { name, type, color, tamano, baseCost, isFavorite } = body;

    // Get user's tenant
    const user = await prisma.user.findUnique({
      where: { id: token.sub },
      select: {
        defaultTenantId: true,
        memberships: {
          where: { isActive: true },
          select: { tenantId: true },
          take: 1
        }
      }
    });

    const tenantId = user?.memberships[0]?.tenantId || user?.defaultTenantId;

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 });
    }

    const frequentProduct = await prisma.inventoryItem.create({
      data: {
        name,
        description: type,
        category: 'General',
        sku: `SKU-${Date.now()}`,
        currentStock: 0,
        minStock: 0,
        unitCost: baseCost || 0,
        sellingPrice: baseCost || 0,
        isActive: true,
        isFavorite: isFavorite || false,
        totalSold: 0,
        createdBy: token.sub as string,
        tenant: { connect: { id: tenantId } }
      }
    });

    // Log audit trail
    try {
      await logCreate(request, 'inventory_product', frequentProduct.id, name, {
        name, type, baseCost, isFavorite
      });
    } catch (auditError) {
      console.error('Failed to log product creation audit:', auditError);
    }

    return NextResponse.json({
      status: 'success',
      data: frequentProduct
    });
  } catch (error) {
    console.error('Error creating frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to create frequent product' },
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
    const { id, name, type, color, tamano, baseCost, isFavorite, active } = body;

    // Get old values for audit
    const oldProduct = await prisma.inventoryItem.findUnique({ where: { id } });

    const frequentProduct = await prisma.inventoryItem.update({
      where: { id },
      data: {
        name,
        description: type,
        unitCost: baseCost || 0,
        sellingPrice: baseCost || 0,
        isFavorite,
        isActive: active !== undefined ? active : true,
        lastUpdated: new Date()
      }
    });

    // Log audit trail
    try {
      await logUpdate(request, 'inventory_product', id, name,
        { name: oldProduct?.name, unitCost: oldProduct?.unitCost, isFavorite: oldProduct?.isFavorite },
        { name, unitCost: baseCost, isFavorite }
      );
    } catch (auditError) {
      console.error('Failed to log product update audit:', auditError);
    }

    return NextResponse.json({
      status: 'success',
      data: frequentProduct
    });
  } catch (error) {
    console.error('Error updating frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to update frequent product' },
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
      return NextResponse.json({ error: 'Product ID is required' }, { status: 400 });
    }

    // Get product data for audit
    const product = await prisma.inventoryItem.findUnique({ where: { id } });

    await prisma.inventoryItem.update({
      where: { id },
      data: { isActive: false, lastUpdated: new Date() }
    });

    // Log audit trail
    try {
      await logDelete(request, 'inventory_product', id, product?.name || 'Unknown',
        { name: product?.name, unitCost: product?.unitCost },
        'Producto frecuente desactivado'
      );
    } catch (auditError) {
      console.error('Failed to log product deletion audit:', auditError);
    }

    return NextResponse.json({
      status: 'success',
      message: 'Frequent product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting frequent product:', error);
    return NextResponse.json(
      { error: 'Failed to delete frequent product' },
      { status: 500 }
    );
  }
}
