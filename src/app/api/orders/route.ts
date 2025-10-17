import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'

export async function GET(request: NextRequest) {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { timestamp: 'desc' },
      take: 100 // Limit to last 100 orders
    })

    return createSuccessResponse(orders)
  } catch (error) {
    return handleApiError(error)
  }
}
