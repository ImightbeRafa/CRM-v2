import { NextRequest, NextResponse } from 'next/server'
import { bulkDelete } from '@/lib/bulkOperations'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  try {
    // Require appropriate permission based on type
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    
    const { tenantId } = auth;
    
    const body = await request.json()
    const { ids, type, reason } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return createErrorResponse('IDs array is required and must not be empty', 400)
    }

    if (!type || typeof type !== 'string') {
      return createErrorResponse('Type is required', 400)
    }

    const validTypes = ['users', 'orders', 'fields', 'optionSets', 'options', 'shipping', 'sellers']
    if (!validTypes.includes(type)) {
      return createErrorResponse(`Invalid type. Must be one of: ${validTypes.join(', ')}`, 400)
    }

    const result = await bulkDelete({ 
      ids, 
      type: type as any, 
      reason,
      request: request as any,
      tenantId: tenantId  // Pass tenant ID for isolation
    })
    
    return createSuccessResponse(result, `Bulk delete completed: ${result.success} successful, ${result.failed} failed`)
  } catch (error) {
    return handleApiError(error)
  }
}
