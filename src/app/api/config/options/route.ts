import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);
    
    const { searchParams } = new URL(request.url)
    const setId = searchParams.get('setId')
    
    if (setId) {
      // Get options for a specific set (auto-filtered by tenantPrisma)
      const options = await prisma.productOption.findMany({
        where: {
          setId,
          active: true,
          tenantId // Direct tenant filter now that ProductOption has tenantId
        },
        orderBy: { label: 'asc' }
      })
      
      return NextResponse.json({ status: 'success', data: options })
    } else {
      // Get all options for this tenant (auto-filtered by tenantPrisma)
      const options = await prisma.productOption.findMany({
        where: {
          active: true,
          tenantId // Direct tenant filter now that ProductOption has tenantId
        },
        include: { set: true },
        orderBy: { label: 'asc' }
      })
      
      return NextResponse.json({ status: 'success', data: options })
    }
  } catch (error) {
    console.error('Options GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);
    const body = await request.json()
    
    // Validate required fields
    if (!body.setId || !body.label || !body.value) {
      return NextResponse.json({ error: 'Missing required fields: setId, label, value' }, { status: 400 })
    }
    
    // Verify the option set belongs to this tenant (auto-filtered by tenantPrisma)
    const optionSet = await prisma.productOptionSet.findFirst({
      where: {
        id: body.setId,
        tenantId
      }
    })
    
    if (!optionSet) {
      return NextResponse.json({ error: 'Option set not found or access denied' }, { status: 404 })
    }
    
    // Create the option with explicit tenantId for proper tenant isolation
    const created = await prisma.productOption.create({
      data: {
        tenantId,
        setId: body.setId,
        label: body.label,
        value: body.value,
        priceDelta: Number(body.priceDelta) || 0,
        metadata: body.metadata || null,
        active: true,
      },
    })
    
    return NextResponse.json({ status: 'success', data: created, message: 'Option created successfully' })
  } catch (error) {
    console.error('Options POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);
    const body = await request.json()
    
    if (!body.id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }
    
    // Verify the option belongs to this tenant (auto-filtered by tenantPrisma)
    const existingOption = await prisma.productOption.findFirst({
      where: {
        id: body.id
      }
    })
    
    if (!existingOption) {
      return NextResponse.json({ error: 'Option not found or access denied' }, { status: 404 })
    }
    
    // Update the option (auto-verified by tenantPrisma)
    const updated = await prisma.productOption.update({
      where: { id: body.id },
      data: {
        label: body.label ?? existingOption.label,
        value: body.value ?? existingOption.value,
        priceDelta: body.priceDelta !== undefined ? Number(body.priceDelta) : existingOption.priceDelta,
        metadata: body.metadata !== undefined ? body.metadata : existingOption.metadata,
        active: body.active ?? existingOption.active,
      },
    })
    
    return NextResponse.json({ status: 'success', data: updated, message: 'Option updated successfully' })
  } catch (error) {
    console.error('Options PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    const prisma = getTenantPrisma(tenantId);
    
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }
    
    // Verify the option belongs to this tenant (auto-filtered by tenantPrisma)
    const existingOption = await prisma.productOption.findFirst({
      where: {
        id
      }
    })
    
    if (!existingOption) {
      return NextResponse.json({ error: 'Option not found or access denied' }, { status: 404 })
    }
    
    // Soft delete the option (auto-verified by tenantPrisma)
    const updated = await prisma.productOption.update({
      where: { id },
      data: { active: false },
    })
    
    return NextResponse.json({ status: 'success', data: updated, message: 'Option deleted successfully' })
  } catch (error) {
    console.error('Options DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
