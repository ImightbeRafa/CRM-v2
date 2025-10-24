import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate, logUpdate, logDelete } from '@/lib/auditLogger'

// Force dynamic rendering for authentication
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const sales = await prisma.order.findMany({
      where: {
        saleDate: { not: null }
      },
      orderBy: { saleDate: 'desc' },
      take: 100 // Limit to last 100 sales
    })

    return createSuccessResponse(sales)
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Create a new sale record
    const sale = await prisma.order.create({
      data: {
        orderId: body.orderId || `SALE-${Date.now()}`,
        orderType: body.orderType || 'EA',
        status: 'Completado',
        customerName: body.customerName || '',
        product: body.product || '',
        quantity: Number(body.quantity || 1),
        total: Number(body.total || 0),
        saleDate: new Date(),
        timestamp: new Date(),
        ...body
      }
    })

    // Log audit trail
    try {
      await logCreate(request, 'sale', sale.id, `Sale #${sale.orderId}`, sale)
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
    }

    return createSuccessResponse(sale, 'Sale created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return createErrorResponse('Missing id parameter', 400)
    }

    const sale = await prisma.order.findUnique({ where: { id } })
    if (!sale) {
      return createErrorResponse('Sale not found', 404)
    }

    await prisma.order.delete({ where: { id } })

    // Log audit trail
    try {
      await logDelete(request, 'sale', id, `Sale #${sale.orderId}`, sale)
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
    }

    return createSuccessResponse(null, 'Sale deleted successfully')
  } catch (error) {
    return handleApiError(error)
  }
}