import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields } from '@/lib/apiUtils'

export async function POST(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
  try {
    const body = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields(body, ['setId', 'label', 'value'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }

    // Idempotent option creation: if an option with same setId+value exists, reactivate/update
    const existing = await prisma.productOption.findFirst({
      where: { setId: body.setId, value: body.value },
    })

    if (existing) {
      const updated = await prisma.productOption.update({
        where: { id: existing.id },
        data: {
          label: body.label ?? existing.label,
          value: body.value,
          priceDelta: Number(body.priceDelta) || existing.priceDelta,
          metadata: body.metadata ?? existing.metadata,
          active: true,
        },
      })
      return createSuccessResponse(updated, 'Option already existed and was reactivated')
    }

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

export async function PUT(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
  try {
    const body = await request.json()
    
    // Validate required fields
    const missingField = validateRequiredFields(body, ['id', 'label', 'value'])
    if (missingField) {
      return createErrorResponse(missingField, 400)
    }
    
    const updated = await prisma.productOption.update({
      where: { id: body.id },
      data: {
        label: body.label,
        value: body.value,
        priceDelta: Number(body.priceDelta) || 0,
        metadata: body.metadata || null,
        active: body.active ?? true,
      },
    })
    return createSuccessResponse(updated, 'Option updated successfully')
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
  try {
    const { searchParams } = new URL((request as any).url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('Missing id parameter', 400)
    }
    
    const updated = await prisma.productOption.update({ 
      where: { id }, 
      data: { active: false } 
    })
    return createSuccessResponse(updated, 'Option deleted successfully')
  } catch (error) {
    return handleApiError(error)
  }
}


