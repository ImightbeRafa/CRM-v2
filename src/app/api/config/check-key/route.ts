import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/apiAuth'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function POST(request: NextRequest) {
  const { authorized } = await requireAdmin(request)
  if (!authorized) return createErrorResponse('Unauthorized', 401)
  
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
        where: { key }
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
        where: { key }
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
