import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/apiUtils'
import { logCreate } from '@/lib/auditLogger'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Create a new order
    const order = await prisma.order.create({
      data: {
        orderId: body.orderId || `ORDER-${Date.now()}`,
        orderType: body.orderType || 'EA',
        status: body.status || 'Pendiente',
        delivery: body.delivery || 'Pendiente',
        customerName: body.customerName || 'Cliente sin nombre',
        username: body.username || '',
        phone: body.phone || '',
        email: body.email || '',
        business: body.business || '',
        product: body.product || '',
        quantity: Number(body.quantity || 0),
        size: body.size || '',
        color: body.color || '',
        packaging: body.packaging || '',
        customization: body.customization || '',
        comments: body.comments || '',
        total: Number(body.total || 0),
        iva: Number(body.iva || 0),
        shippingCost: Number(body.shippingCost || 0),
        productCost: Number(body.productCost || 0),
        funnel: body.funnel || '',
        address: body.address || '',
        province: body.province || '',
        canton: body.canton || '',
        district: body.district || '',
        courier: body.courier || '',
        expectedDate: body.expectedDate || '',
        saleDate: body.saleDate ? new Date(body.saleDate).toISOString() : new Date().toISOString(),
        agreedDate: body.agreedDate || '',
        pickupDate: body.pickupDate || '',
        seller: body.seller || '',
        timestamp: new Date()
      }
    })

    // Log audit trail
    try {
      await logCreate(request, 'order', order.id, `Order #${order.orderId}`, order)
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
    }

    return createSuccessResponse(order, 'Order created successfully')
  } catch (error) {
    return handleApiError(error)
  }
}
