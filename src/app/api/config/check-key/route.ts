import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { getMembershipForToken } from '@/lib/selected-tenant'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
  if (!token?.sub) return createErrorResponse('Unauthorized', 401)
  const membership = await getMembershipForToken(token)
  if (!membership) return createErrorResponse('Selected tenant membership not found', 403)
  
  try {
    const body = await request.json()
    const { key, type = 'optionSet' } = body
    
    if (!key) {
      return createErrorResponse('Key is required', 400)
    }
    
    let exists = false
    let suggestions: string[] = []
    
    if (type === 'optionSet') {
      const existing = await prisma.productOptionSet.findFirst({
        where: { tenantId: membership.tenantId, key }
      })
      exists = !!existing
      
      if (exists) {
        // Generate suggestions
        const baseKey = key.toLowerCase()
        suggestions = [
          `${baseKey}_1`,
          `${baseKey}_2`,
          `${baseKey}_new`,
          `${baseKey}_alt`,
          `new_${baseKey}`
        ]
      }
    } else if (type === 'field') {
      const existing = await prisma.productField.findFirst({
        where: { tenantId: membership.tenantId, key }
      })
      exists = !!existing
      
      if (exists) {
        const baseKey = key.toLowerCase()
        suggestions = [
          `${baseKey}_1`,
          `${baseKey}_2`,
          `${baseKey}_new`,
          `${baseKey}_alt`,
          `new_${baseKey}`
        ]
      }
    }
    
    return createSuccessResponse({
      key,
      exists,
      suggestions: exists ? suggestions : []
    })
  } catch (error) {
    return handleApiError(error)
  }
}
