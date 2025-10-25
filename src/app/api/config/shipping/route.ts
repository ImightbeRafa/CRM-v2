import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    // CRITICAL: Only show shipping methods for this tenant (auto-filtered by tenantPrisma)
    const methods = await prisma.shippingMethod.findMany({ 
      where: { 
        active: true
      }, 
      orderBy: { name: 'asc' } 
    });
    
    return NextResponse.json({ status: 'success', data: methods });
  } catch (error) {
    console.error('Error fetching shipping methods:', error);
    // If table doesn't exist yet, return empty array
    if (error instanceof Error && error.message.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] });
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load shipping methods' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const body = await request.json();
    
    // CRITICAL: Create shipping method with tenant isolation (auto-injected by tenantPrisma)
    const created = await prisma.shippingMethod.create({ 
      data: { 
        name: body.name, 
        carrier: body.carrier || null, 
        basePrice: Number(body.basePrice) || 0, 
        active: true,
        tenant: { connect: { id: tenantId } }
      } 
    });
    
    return NextResponse.json({ status: 'success', data: created });
  } catch (error) {
    console.error('Error creating shipping method:', error);
    return NextResponse.json({ status: 'error', error: 'Failed to create shipping method' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const body = await request.json();
    
    // CRITICAL: Update with tenant isolation (auto-verified by tenantPrisma)
    const updated = await prisma.shippingMethod.update({ 
      where: { id: body.id }, 
      data: { 
        name: body.name, 
        carrier: body.carrier || null, 
        basePrice: Number(body.basePrice) || 0, 
        active: body.active ?? true 
      } 
    });
    
    return NextResponse.json({ status: 'success', data: updated });
  } catch (error) {
    console.error('Error updating shipping method:', error);
    return NextResponse.json({ status: 'error', error: 'Failed to update shipping method' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }
    
    // CRITICAL: Soft delete with tenant isolation (auto-verified by tenantPrisma)
    const updated = await prisma.shippingMethod.update({ 
      where: { id }, 
      data: { active: false } 
    });
    
    return NextResponse.json({ status: 'success', data: updated });
  } catch (error) {
    console.error('Error deleting shipping method:', error);
    return NextResponse.json({ status: 'error', error: 'Failed to delete shipping method' }, { status: 500 });
  }
}


