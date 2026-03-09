import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { withTenantContext } from '@/lib/tenantContext'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const fields = await prisma.productField.findMany({
      where: { active: true, tenantId },
      orderBy: { order: 'asc' },
      include: { 
        optionSet: { 
          include: { 
            options: { 
              where: { active: true, tenantId } // Explicit tenant filter for nested options
            } 
          } 
        } 
      },
    })
    return NextResponse.json({ status: 'success', data: fields })
  } catch (error) {
    // If table doesn't exist yet, return empty array
    if (error instanceof Error && error.message.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load fields' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require 'update_config' permission to create/modify fields
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    // Idempotent enable/create behavior:
    // - If a field with the same key exists and is inactive, reactivate and update
    // - If it exists and is active, return existing as success
    // - Otherwise, create a new one
    const existing = await prisma.productField.findFirst({ 
      where: { key: body.key } // findFirst for tenant-aware query
    })

    if (existing) {
      const updateData: any = {
        label: body.label ?? existing.label,
        type: body.type ?? existing.type,
        required: body.required !== undefined ? Boolean(body.required) : existing.required,
        order: body.order !== undefined ? Number(body.order) : existing.order,
        multiSelect: body.multiSelect !== undefined ? Boolean(body.multiSelect) : existing.multiSelect,
        active: true,
      };
      
      // Handle optionSet relation properly
      if (body.optionSetId !== undefined) {
        if (body.optionSetId === null) {
          updateData.optionSet = { disconnect: true };
        } else {
          updateData.optionSet = { connect: { id: body.optionSetId } };
        }
      }
      
      const updated = await prisma.productField.update({
        where: { id: existing.id },
        data: updateData,
      })
      return NextResponse.json({ status: 'success', data: updated })
    }

    const created = await prisma.productField.create({
      data: {
        key: body.key,
        label: body.label,
        type: body.type,
        required: Boolean(body.required),
        order: Number(body.order) || 0,
        optionSetId: body.optionSetId ?? null,
        multiSelect: Boolean(body.multiSelect),
        active: true,
        tenantId
      },
    })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    console.error('Error creating field:', e)
    return NextResponse.json({ 
      status: 'error', 
      error: 'Failed to create or enable field'
    }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    
    const updateData: any = {
      label: body.label,
      type: body.type,
      required: body.required,
      order: Number(body.order),
      multiSelect: Boolean(body.multiSelect),
      active: body.active ?? true,
    };
    
    // Handle optionSet relation properly
    if (body.optionSetId !== undefined) {
      if (body.optionSetId === null) {
        updateData.optionSet = { disconnect: true };
      } else {
        updateData.optionSet = { connect: { id: body.optionSetId } };
      }
    }
    
    const updated = await prisma.productField.update({
      where: { id: body.id },
      data: updateData,
    })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update field' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const userId = (auth as any)?.userId || 'system'
    const userRole = (auth as any)?.userRole
    const userName = (auth as any)?.session?.user?.name || (auth as any)?.session?.user?.email || 'System'

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId)
      // Use updateMany with tenant filter to avoid cross-tenant or P2025 throws
      const result = await prisma.productField.updateMany({
        where: { id, tenantId, active: true },
        data: { active: false }
      })
      // eslint-disable-next-line no-console
      console.log('[config/fields DELETE] updateMany count:', result.count)
      if (result.count === 0) {
        return NextResponse.json({ status: 'error', error: 'Field not found' }, { status: 404 })
      }
      return NextResponse.json({ status: 'success' })
    })
  } catch (e) {
    console.error('[config/fields DELETE] Unexpected error:', e)
    return NextResponse.json({ status: 'error', error: 'Failed to delete field (auth/context)' }, { status: 500 })
  }
}


