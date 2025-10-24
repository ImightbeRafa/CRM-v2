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
    // Idempotent: if key exists for this tenant (even inactive), update/reactivate; else create
    const existing = await prisma.orderStatus.findFirst({ 
      where: { 
        key: body.key,
        tenantId 
      } 
    })
    if (existing) {
      const updated = await prisma.orderStatus.update({
        where: { id: existing.id },
        data: {
          label: body.label ?? existing.label,
          color: body.color ?? existing.color,
          order: body.order ?? existing.order,
          isActive: true,
        },
      })
      return NextResponse.json({ status: 'success', data: updated })
    }
    const created = await prisma.orderStatus.create({ 
      data: { 
        key: body.key, 
        label: body.label, 
        color: body.color || null, 
        order: Number(body.order) || 0, 
        isActive: true,
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
    const updated = await prisma.orderStatus.update({ 
      where: { id: body.id },
      data: { 
        key: body.key, 
        label: body.label, 
        color: body.color || null, 
        order: Number(body.order) || 0, 
        isActive: body.isActive ?? true 
      } 
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


