import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createSuccessResponse, createErrorResponse, handleApiError, validateRequiredFields } from '@/lib/apiUtils'

export async function GET() {
  try {
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

export async function POST(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
  try {
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
    
    // Check if key already exists (active or inactive)
    const existingSet = await prisma.productOptionSet.findUnique({
      where: { key: body.key }
    })
    
    if (existingSet && existingSet.active) {
      return createErrorResponse('This key already exists. Please choose a different key.', 409)
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
            active: true 
          } 
        })
    return createSuccessResponse(result, 'Option set created successfully')
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

export async function DELETE(request: Request) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
  try {
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


