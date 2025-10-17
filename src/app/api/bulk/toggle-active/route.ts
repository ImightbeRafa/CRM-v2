import { NextRequest, NextResponse } from 'next/server'
import { bulkToggleActive } from '@/lib/bulkOperations'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, type, active } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse('IDs array is required and must not be empty', 400)
    }

    if (!type || typeof type !== 'string') {
      return createErrorResponse('Type is required', 400)
    }

    if (typeof active !== 'boolean') {
      return createErrorResponse('Active must be a boolean value', 400)
    }

    const validTypes = ['users', 'fields', 'optionSets', 'options', 'shipping', 'sellers']
    if (!validTypes.includes(type)) {
      return createErrorResponse(`Invalid type. Must be one of: ${validTypes.join(', ')}`, 400)
    }

    const result = await bulkToggleActive(ids, type as any, active)
    
    return createSuccessResponse(result, `Bulk toggle completed: ${result.success} successful, ${result.failed} failed`)
  } catch (error) {
    return handleApiError(error)
  }
}
