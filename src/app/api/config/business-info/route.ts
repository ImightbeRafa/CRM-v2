import { NextRequest, NextResponse } from 'next/server';
import { getTenantPrisma } from '@/lib/prisma-tenant';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);

    // CRITICAL: Only show business info for this tenant (auto-filtered by tenantPrisma)
    const businessInfo = await prisma.businessInfo.findMany({
      where: { 
        isActive: true 
      },
      orderBy: { order: 'asc' }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error fetching business info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch business info' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId } = auth;
    const prisma = getTenantPrisma(tenantId);

    const body = await request.json();
    const { name, type, label, placeholder, options, required, order } = body;

    // CRITICAL: Create business info with tenant isolation (auto-injected by tenantPrisma)
    const businessInfo = await prisma.businessInfo.create({
      data: {
        name,
        type,
        label,
        placeholder,
        options: options ? JSON.stringify(options) : null,
        required: required || false,
        order: order || 0,
        isActive: true,
        createdBy: userId,
        tenant: { connect: { id: tenantId } }
      }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error creating business info:', error);
    return NextResponse.json(
      { error: 'Failed to create business info' },
      { status: 500 }
    );
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
    const { id, name, type, label, placeholder, options, required, order, active } = body;

    // CRITICAL: Update with tenant isolation (auto-verified by tenantPrisma)
    const businessInfo = await prisma.businessInfo.update({
      where: { id },
      data: {
        name,
        type,
        label,
        placeholder,
        options: options ? JSON.stringify(options) : null,
        required: required || false,
        order: order || 0,
        isActive: active !== undefined ? active : true,
        updatedAt: new Date()
      }
    });

    return NextResponse.json({
      status: 'success',
      data: businessInfo
    });
  } catch (error) {
    console.error('Error updating business info:', error);
    return NextResponse.json(
      { error: 'Failed to update business info' },
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
    const prisma = getTenantPrisma(tenantId);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Business info ID is required' }, { status: 400 });
    }

    // CRITICAL: Soft delete with tenant isolation (auto-verified by tenantPrisma)
    await prisma.businessInfo.update({
      where: { id },
      data: { isActive: false, updatedAt: new Date() }
    });

    return NextResponse.json({
      status: 'success',
      message: 'Business info deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting business info:', error);
    return NextResponse.json(
      { error: 'Failed to delete business info' },
      { status: 500 }
    );
  }
}
