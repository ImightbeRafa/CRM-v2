import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { prisma } from '@/lib/db'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    })

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }

    const tenantId = user.memberships[0].tenantId
    const tenantPrisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL(request.url)
    const setId = searchParams.get('setId')
    
    if (setId) {
      // Get options for a specific set
      const options = await tenantPrisma.productOption.findMany({
        where: { 
          setId,
          active: true 
        },
        orderBy: { label: 'asc' }
      })
      
      return NextResponse.json({ status: 'success', data: options })
    } else {
      // Get all options for this tenant
      const options = await tenantPrisma.productOption.findMany({
        where: { 
          active: true
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
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    })

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }

    const tenantId = user.memberships[0].tenantId
    const tenantPrisma = getTenantPrisma(tenantId)
    const body = await request.json()
    
    // Validate required fields
    if (!body.setId || !body.label || !body.value) {
      return NextResponse.json({ error: 'Missing required fields: setId, label, value' }, { status: 400 })
    }
    
    // Verify the option set belongs to this tenant
    const optionSet = await tenantPrisma.productOptionSet.findFirst({
      where: { 
        id: body.setId
      }
    })
    
    if (!optionSet) {
      return NextResponse.json({ error: 'Option set not found or access denied' }, { status: 404 })
    }
    
    // Create the option
    const created = await tenantPrisma.productOption.create({
      data: {
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
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    })

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }

    const tenantId = user.memberships[0].tenantId
    const tenantPrisma = getTenantPrisma(tenantId)
    const body = await request.json()
    
    if (!body.id) {
      return NextResponse.json({ error: 'Missing required field: id' }, { status: 400 })
    }
    
    // Verify the option belongs to this tenant (via option set)
    const existingOption = await tenantPrisma.productOption.findFirst({
      where: {
        id: body.id
      }
    })
    
    if (!existingOption) {
      return NextResponse.json({ error: 'Option not found or access denied' }, { status: 404 })
    }
    
    // Update the option
    const updated = await tenantPrisma.productOption.update({
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
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user with memberships to find tenant ID
    const user = await prisma.user.findUnique({
      where: { id: token.sub as string },
      include: { memberships: true }
    })

    if (!user || !user.memberships.length) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }

    const tenantId = user.memberships[0].tenantId
    const tenantPrisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }
    
    // Verify the option belongs to this tenant (via option set)
    const existingOption = await tenantPrisma.productOption.findFirst({
      where: {
        id
      }
    })
    
    if (!existingOption) {
      return NextResponse.json({ error: 'Option not found or access denied' }, { status: 404 })
    }
    
    // Soft delete the option
    const updated = await tenantPrisma.productOption.update({
      where: { id },
      data: { active: false },
    })
    
    return NextResponse.json({ status: 'success', data: updated, message: 'Option deleted successfully' })
  } catch (error) {
    console.error('Options DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
