import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';
import { withTenantContext } from '@/lib/tenantContext';
import { getToken } from 'next-auth/jwt';

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    const userId = token?.sub || auth.userId;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    return await withTenantContext({ tenantId, userId, role: auth.role, userRole: auth.role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      const inventory = await prisma.inventoryItem.findMany({
        where: {
          tenantId,
          isActive: true
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
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    const userId = token?.sub || auth.userId;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    
    return await withTenantContext({ 
      tenantId, 
      userId, 
      role: auth.role, 
      userRole: auth.role, 
      userName 
    }, async () => {
      const prisma = getTenantPrisma(tenantId);
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

      // Check if SKU already exists for this tenant (active or inactive)
      const existingItem = await prisma.inventoryItem.findFirst({
        where: { sku }
      });

      if (existingItem) {
        // If inactive, reactivate and update instead of creating a duplicate (preserves uniqueness)
        if (!existingItem.isActive) {
          const reactivated = await prisma.inventoryItem.update({
            where: { id: existingItem.id },
            data: {
              name,
              description,
              category,
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
              lastUpdated: new Date(),
            }
          });

          return NextResponse.json({ status: 'success', data: reactivated });
        }

        // If already active, block with a clear error
        return NextResponse.json(
          { error: 'SKU already exists' },
          { status: 400 }
        );
      }

      let inventoryItem;
      try {
        inventoryItem = await prisma.inventoryItem.create({
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
            createdBy: userId,
            tenantId
          }
        });
      } catch (e: any) {
        // Handle unique constraint on (tenantId, sku): fallback to update/reactivate
        if (e?.code === 'P2002') {
          const existing = await prisma.inventoryItem.findFirst({ where: { sku, tenantId } });
          if (!existing) {
            return NextResponse.json(
              { error: 'SKU already exists but item not found for update' },
              { status: 400 }
            );
          }
          const reactivated = await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              name,
              description,
              category,
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
              lastUpdated: new Date(),
            }
          });
          inventoryItem = reactivated;
        } else {
          throw e;
        }
      }

      return NextResponse.json({
        status: 'success',
        data: inventoryItem
      });
    });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    const details = error instanceof Error ? error.message : String(error);
    const payload = process.env.NODE_ENV === 'production' 
      ? { error: 'Failed to create inventory item' }
      : { error: 'Failed to create inventory item', details };
    return NextResponse.json(payload, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    const userId = token?.sub || auth.userId;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    return await withTenantContext({ tenantId, userId, role: auth.role, userRole: auth.role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
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

      // Check if SKU already exists for different item (auto-filtered by tenantPrisma)
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
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET });
    const userId = token?.sub || auth.userId;
    const userName = (token as any)?.name || (token as any)?.email || 'System';
    return await withTenantContext({ tenantId, userId, role: auth.role, userRole: auth.role, userName }, async () => {
      const prisma = getTenantPrisma(tenantId);
      const { searchParams } = new URL(request.url);
      const id = searchParams.get('id');

      if (!id) {
        return NextResponse.json({ error: 'Item ID is required' }, { status: 400 });
      }

      // CRITICAL: Soft delete with tenant isolation (auto-verified by tenantPrisma)
      await prisma.inventoryItem.update({
        where: { id },
        data: { isActive: false }
      });

      return NextResponse.json({
        status: 'success',
        message: 'Inventory item deleted successfully'
      });
    });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return NextResponse.json(
      { error: 'Failed to delete inventory item' },
      { status: 500 }
    );
  }
}
