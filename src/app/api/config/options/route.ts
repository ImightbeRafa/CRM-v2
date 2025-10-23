import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields } from '@/lib/apiUtils'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL(request.url)
    const setId = searchParams.get('setId')
    
    if (setId) {
      // Get options for a specific set
      const options = await prisma.productOption.findMany({
        where: { 
          setId,
          active: true 
        },
        orderBy: { label: 'asc' }
      })
      return createSuccessResponse(options)
    } else {
      // Get all options (with tenant check via option set)
      const options = await prisma.productOption.findMany({
        where: { 
          active: true,
          set: { tenantId }
        },
        include: { set: true },
        orderBy: { label: 'asc' }
      })
      return createSuccessResponse(options)
    }
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    
    const missingField = validateRequiredFields(body, ['setId', 'label', 'value'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Verify the option set belongs to this tenant
    const optionSet = await prisma.productOptionSet.findFirst({
      where: { 
        id: body.setId,
        tenantId 
      }
    })
    
    if (!optionSet) {
      return createErrorResponse('Option set not found or access denied', 404)
    }
    
    // Create the option
    const created = await prisma.productOption.create({
      data: {
        setId: body.setId,
        label: body.label,
        value: body.value,
        priceDelta: Number(body.priceDelta) || 0,
        metadata: body.metadata || null,
        active: true,
      },
    })
    
    return createSuccessResponse(created, 'Option created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const body = await request.json()
    
    const missingField = validateRequiredFields(body, ['id'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Verify the option belongs to this tenant (via option set)
    const existingOption = await prisma.productOption.findFirst({
      where: {
        id: body.id,
        set: { tenantId }
      }
    })
    
    if (!existingOption) {
      return createErrorResponse('Option not found or access denied', 404)
    }
    
    // Update the option
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
    
    return createSuccessResponse(updated, 'Option updated successfully')
  } catch (error) {
    return handleApiError(error)
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
    
    if (!id) {
      return createErrorResponse('Missing id parameter', 400)
    }
    
    // Verify the option belongs to this tenant (via option set)
    const existingOption = await prisma.productOption.findFirst({
      where: {
        id,
        set: { tenantId }
      }
    })
    
    if (!existingOption) {
      return createErrorResponse('Option not found or access denied', 404)
    }
    
    // Soft delete
    const updated = await prisma.productOption.update({
      where: { id },
      data: { active: false },
    })
    
    return createSuccessResponse(updated, 'Option deleted successfully')
  } catch (error) {
    return handleApiError(error)
  }
}
