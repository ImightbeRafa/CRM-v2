import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPI, authenticateAPIWithPermission } from '@/lib/auth-helpers'

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const sellers = await prisma.seller.findMany({ 
      where: { active: true }, 
      orderBy: { name: 'asc' } 
    })
    return NextResponse.json({ status: 'success', data: sellers })
  } catch (error) {
    // If table doesn't exist yet, return empty array
    if (error instanceof Error && error.message.includes('does not exist')) {
      return NextResponse.json({ status: 'success', data: [] })
    }
    return NextResponse.json({ status: 'error', error: 'Failed to load sellers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    const created = await prisma.seller.create({ 
      data: { 
        name: body.name, 
        active: true 
        // tenantId auto-injected by prisma-tenant
      } 
    })
    return NextResponse.json({ status: 'success', data: created })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to create seller' }, { status: 500 })
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
    const updated = await prisma.seller.update({ 
      where: { id: body.id }, 
      data: { name: body.name, active: body.active ?? true } 
    })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to update seller' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    
    const updated = await prisma.seller.update({ where: { id }, data: { active: false } })
    return NextResponse.json({ status: 'success', data: updated })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Failed to delete seller' }, { status: 500 })
  }
}


