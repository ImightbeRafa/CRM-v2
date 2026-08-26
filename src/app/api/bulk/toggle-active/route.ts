import { NextRequest, NextResponse } from 'next/server'
import { bulkToggleActive } from '@/lib/bulkOperations'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  try {
    // Require appropriate permission
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId, userId, role, session } = auth;
    
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

    // Pass tenant ID for isolation
    const result = await bulkToggleActive(ids, type as any, active, tenantId)
    
    return createSuccessResponse(result, `Bulk toggle completed: ${result.success} successful, ${result.failed} failed`)
  } catch (error) {
    return handleApiError(error)
  }
}
