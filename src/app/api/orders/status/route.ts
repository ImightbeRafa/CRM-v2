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
    try {
      console.log('Logging order status update:', {
        orderId: body.orderId,
        oldStatus: existingOrder.status,
        newStatus: body.status
      })
      await logUpdate(request as any, 'order', updatedOrder.id, `Order #${body.orderId}`, 
        { status: existingOrder.status }, 
        { status: body.status })
    } catch (auditError) {
      console.error('Failed to log audit trail:', auditError)
      // Try manual audit log
      try {
        await prisma.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'order',
            entityId: updatedOrder.id,
            entityName: `Order #${body.orderId}`,
            oldValues: { status: existingOrder.status },
            newValues: { status: body.status },
            userId: 'system',
            userName: 'System',
            userRole: 'MASTER',
            ipAddress: 'unknown',
            userAgent: 'unknown'
          }
        })
        console.log('Manual audit log created for status update')
      } catch (manualError) {
        console.error('Failed to create manual audit log:', manualError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}