import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logUpdate } from '@/lib/auditLogger'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.orderId || !body.status) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, status' },
        { status: 400 }
      )
    }

    // Get the existing order for audit logging
    const existingOrder = await prisma.order.findUnique({
      where: { orderId: body.orderId }
    })

    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const updatedOrder = await prisma.order.update({
      where: { orderId: body.orderId },
      data: { status: body.status }
    })

    // Log audit trail
    console.log('Logging status update:', {
      orderId: body.orderId,
      oldStatus: existingOrder.status,
      newStatus: body.status,
      userId: 'will-be-determined-by-audit-logger'
    })
    await logUpdate(request as any, 'order', updatedOrder.id, `Order #${body.orderId}`, 
      { status: existingOrder.status }, 
      { status: body.status })

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}