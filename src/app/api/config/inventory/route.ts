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
      // Wizard sends: productName, sku, quantity, price
      // API expects: name, description, category, sku, currentStock, minStock, maxStock, unitCost, sellingPrice, supplier, location, reorderPoint, reorderQuantity, isFavorite
      const {
        productName,
        name: apiName,
        description,
        category,
        sku,
        quantity,
        currentStock,
        minStock,
        maxStock,
        price,
        unitCost,
        sellingPrice,
        supplier,
        location,
        reorderPoint,
        reorderQuantity,
        isFavorite
      } = body;
      
      // Map wizard fields to API fields
      const mappedName = apiName || productName;
      const mappedCurrentStock = currentStock !== undefined ? currentStock : (quantity !== undefined ? quantity : 0);
      const mappedSellingPrice = sellingPrice !== undefined ? sellingPrice : (price !== undefined ? price : 0);
      const mappedUnitCost = unitCost !== undefined ? unitCost : (price !== undefined ? price : 0);

      // Check if SKU already exists for this tenant (active or inactive)
      const existingItem = await prisma.inventoryItem.findFirst({
        where: { sku: sku || `SKU-${Date.now()}` }
      });

      if (existingItem) {
        // If inactive, reactivate and update instead of creating a duplicate (preserves uniqueness)
        if (!existingItem.isActive) {
          const reactivated = await prisma.inventoryItem.update({
            where: { id: existingItem.id },
            data: {
              name: mappedName,
              description: description || 'Producto de inventario',
              category: category || 'General',
              currentStock: parseInt(String(mappedCurrentStock)) || 0,
              minStock: parseInt(String(minStock)) || 0,
              maxStock: maxStock ? parseInt(String(maxStock)) : null,
              unitCost: parseFloat(String(mappedUnitCost)) || 0,
              sellingPrice: parseFloat(String(mappedSellingPrice)) || 0,
              supplier: supplier || null,
              location: location || null,
              reorderPoint: parseInt(String(reorderPoint)) || 0,
              reorderQuantity: parseInt(String(reorderQuantity)) || 0,
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
            name: mappedName,
            description: description || 'Producto de inventario',
            category: category || 'General',
            sku: sku || `SKU-${Date.now()}`,
            currentStock: parseInt(String(mappedCurrentStock)) || 0,
            minStock: parseInt(String(minStock)) || 0,
            maxStock: maxStock ? parseInt(String(maxStock)) : null,
            unitCost: parseFloat(String(mappedUnitCost)) || 0,
            sellingPrice: parseFloat(String(mappedSellingPrice)) || 0,
            supplier: supplier || null,
            location: location || null,
            reorderPoint: parseInt(String(reorderPoint)) || 0,
            reorderQuantity: parseInt(String(reorderQuantity)) || 0,
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
              name: mappedName,
              description: description || 'Producto de inventario',
              category: category || 'General',
              currentStock: parseInt(String(mappedCurrentStock)) || 0,
              minStock: parseInt(String(minStock)) || 0,
              maxStock: maxStock ? parseInt(String(maxStock)) : null,
              unitCost: parseFloat(String(mappedUnitCost)) || 0,
              sellingPrice: parseFloat(String(mappedSellingPrice)) || 0,
              supplier: supplier || null,
              location: location || null,
              reorderPoint: parseInt(String(reorderPoint)) || 0,
              reorderQuantity: parseInt(String(reorderQuantity)) || 0,
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
      // Wizard sends: id, productName, sku, quantity, price
      // API expects: id, name, description, category, sku, currentStock, minStock, maxStock, unitCost, sellingPrice, supplier, location, reorderPoint, reorderQuantity, isFavorite
      const {
        id,
        productName,
        name: apiName,
        description,
        category,
        sku,
        quantity,
        currentStock,
        minStock,
        maxStock,
        price,
        unitCost,
        sellingPrice,
        supplier,
        location,
        reorderPoint,
        reorderQuantity,
        isFavorite
      } = body;
      
      // Map wizard fields to API fields
      const mappedName = apiName || productName;
      const mappedCurrentStock = currentStock !== undefined ? currentStock : (quantity !== undefined ? quantity : undefined);
      const mappedSellingPrice = sellingPrice !== undefined ? sellingPrice : (price !== undefined ? price : undefined);
      const mappedUnitCost = unitCost !== undefined ? unitCost : (price !== undefined ? price : undefined);

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

      // Get existing item to preserve values not provided by wizard
      const existing = await prisma.inventoryItem.findUnique({ where: { id } });
      
      const inventoryItem = await prisma.inventoryItem.update({
        where: { id },
        data: {
          name: mappedName || existing?.name,
          description: description || existing?.description || 'Producto de inventario',
          category: category || existing?.category || 'General',
          sku: sku || existing?.sku,
          currentStock: mappedCurrentStock !== undefined ? parseInt(String(mappedCurrentStock)) : (currentStock !== undefined ? parseInt(String(currentStock)) : existing?.currentStock || 0),
          minStock: minStock !== undefined ? parseInt(String(minStock)) : existing?.minStock || 0,
          maxStock: maxStock !== undefined ? (maxStock ? parseInt(String(maxStock)) : null) : existing?.maxStock,
          unitCost: mappedUnitCost !== undefined ? parseFloat(String(mappedUnitCost)) : (unitCost !== undefined ? parseFloat(String(unitCost)) : existing?.unitCost || 0),
          sellingPrice: mappedSellingPrice !== undefined ? parseFloat(String(mappedSellingPrice)) : (sellingPrice !== undefined ? parseFloat(String(sellingPrice)) : existing?.sellingPrice || 0),
          supplier: supplier !== undefined ? supplier : existing?.supplier,
          location: location !== undefined ? location : existing?.location,
          reorderPoint: reorderPoint !== undefined ? parseInt(String(reorderPoint)) : existing?.reorderPoint || 0,
          reorderQuantity: reorderQuantity !== undefined ? parseInt(String(reorderQuantity)) : existing?.reorderQuantity || 0,
          isFavorite: isFavorite !== undefined ? isFavorite : existing?.isFavorite || false,
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
