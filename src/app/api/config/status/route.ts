import { NextResponse, NextRequest } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const statuses = await prisma.orderStatus.findMany({ 
      where: { 
        tenantId,
        isActive: true 
      }, 
      orderBy: { order: 'asc' } 
    })
    return NextResponse.json({ status: 'success', data: statuses })
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : ''
    if (msg.includes('no such table') || msg.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load statuses' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    // Wizard sends: name, color, order, isActive
    // API expects: key, label, color, order, isActive
    const { name, key, label, color, order, isActive } = body
    const statusKey = key || (name ? name.toLowerCase().replace(/[^a-z0-9]/g, '-') : `status-${Date.now()}`)
    const statusLabel = label || name || 'Estado'
    
    // Idempotent: if key exists for this tenant (even inactive), update/reactivate; else create
    const existing = await prisma.orderStatus.findFirst({ 
      where: { 
        key: statusKey,
        tenantId 
      } 
    })
    if (existing) {
      const updated = await prisma.orderStatus.update({
        where: { id: existing.id },
        data: {
          label: statusLabel,
          color: color ?? existing.color,
          order: order !== undefined ? Number(order) : existing.order,
          isActive: isActive !== undefined ? isActive : true,
        },
      })
      return NextResponse.json({ status: 'success', data: updated })
    }
    const created = await prisma.orderStatus.create({ 
      data: { 
        key: statusKey, 
        label: statusLabel, 
        color: color || null, 
        order: Number(order) || 0, 
        isActive: isActive !== undefined ? isActive : true,
        tenantId 
      } 
    })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to create status' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    // Wizard sends: id, name, color, order, isActive
    // API expects: id, key, label, color, order, isActive
    const { id, name, key, label, color, order, isActive } = body
    const statusLabel = label || name
    
    // Build update data object with only provided fields
    const updateData: any = {
      color: (color || body.color) || null, 
      order: order !== undefined ? Number(order) : Number(body.order || 0), 
      isActive: isActive !== undefined ? isActive : (body.isActive ?? true) 
    }
    
    // Only update key and label if provided
    if (key || body.key) {
      updateData.key = key || body.key
    }
    if (statusLabel || body.label) {
      updateData.label = statusLabel || body.label
    }
    
    const updated = await prisma.orderStatus.update({ 
      where: { id: id || body.id },
      data: updateData
    })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update status' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    
    const updated = await prisma.orderStatus.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to delete status' }, { status: 500 })
  }
}


