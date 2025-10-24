import { NextRequest, NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields } from '@/lib/apiUtils'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // Require 'view_config' permission
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const sets = await prisma.productOptionSet.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      include: { options: { where: { active: true }, orderBy: { label: 'asc' } } }
    })
    return createSuccessResponse(sets)
  } catch (error) {
    return handleApiError(error)
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
    
    // Validate required fields
    const missingField = validateRequiredFields(body, ['key', 'name'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    // Validate key format (alphanumeric and underscores only)
    if (!/^[a-zA-Z0-9_]+$/.test(body.key)) {
      return createErrorResponse('Key must contain only letters, numbers, and underscores', 400)
    }
    
    // Check if key already exists (active or inactive) - use findFirst for tenant isolation
    const existingSet = await prisma.productOptionSet.findFirst({
      where: { key: body.key }
    })
    
    if (existingSet && existingSet.active) {
      // Idempotent: return success with existing active set
      return createSuccessResponse(existingSet, 'Option set already exists')
    }
    
    // If inactive record exists, reactivate it; otherwise create new one
    const result = existingSet 
      ? await prisma.productOptionSet.update({
          where: { id: existingSet.id },
          data: { 
            name: body.name, 
            active: true 
          }
        })
      : await prisma.productOptionSet.create({ 
          data: { 
            key: body.key, 
            name: body.name, 
            active: true,
            tenant: { connect: { id: tenantId } }
          } 
        })
    return createSuccessResponse(result, 'Option set created successfully')
  } catch (error) {
    return handleApiError(error)
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
    
    // Validate required fields
    const missingField = validateRequiredFields(body, ['id', 'name'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    const updated = await prisma.productOptionSet.update({ 
      where: { id: body.id }, 
      data: { 
        name: body.name, 
        active: body.active ?? true 
      } 
    })
    return createSuccessResponse(updated, 'Option set updated successfully')
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Require 'update_config' permission
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    
    const { tenantId } = auth
    const prisma = getTenantPrisma(tenantId)
    
    const { searchParams } = new URL((request as any).url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('Missing id parameter', 400)
    }
    
    const updated = await prisma.productOptionSet.update({ 
      where: { id }, 
      data: { active: false } 
    })
    return createSuccessResponse(updated, 'Option set deleted successfully')
  } catch (error) {
    return handleApiError(error)
  }
}


