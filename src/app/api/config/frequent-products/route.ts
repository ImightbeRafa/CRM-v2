import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { logCreate, logUpdate, logDelete } from '@/lib/auditLogger';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const body = await request.json();
    // Wizard sends: name, price, description
    // API expects: name, type, color, tamano, baseCost, isFavorite
    const { name, price, description, type, color, tamano, baseCost, isFavorite } = body;

    const frequentProduct = await prisma.inventoryItem.create({
      data: {
        name,
        description: description || type || 'Producto frecuente',
        category: 'General',
        sku: `SKU-${Date.now()}`,
        currentStock: 0,
        minStock: 0,
        unitCost: baseCost || price || 0,
        sellingPrice: price || baseCost || 0,
        isActive: true,
        isFavorite: isFavorite || false,
        totalSold: 0,
        createdBy: userId,
        tenantId
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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const body = await request.json();
    // Wizard sends: id, name, price, description
    const { id, name, price, description, type, color, tamano, baseCost, isFavorite, active } = body;

    // Get old values for audit
    const oldProduct = await prisma.inventoryItem.findUnique({ where: { id } });

    const frequentProduct = await prisma.inventoryItem.update({
      where: { id },
      data: {
        name,
        description: description || type || oldProduct?.description || 'Producto frecuente',
        unitCost: baseCost || price || oldProduct?.unitCost || 0,
        sellingPrice: price || baseCost || oldProduct?.sellingPrice || 0,
        isFavorite: isFavorite !== undefined ? isFavorite : oldProduct?.isFavorite || false,
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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

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
