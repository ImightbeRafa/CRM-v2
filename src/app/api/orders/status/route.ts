import { NextResponse } from 'next/server'
import { logUpdate } from '@/lib/auditLogger'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { withTenantContext } from '@/lib/tenantContext'
import { getToken } from 'next-auth/jwt'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.orderId || !body.status) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, status' },
        { status: 400 }
      )
    }
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const tenantId = (token as any).tenantId as string
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })
    }
    const userId = (token as any)?.sub as string | undefined
    const userName = (token as any)?.name || (token as any)?.email || 'System'
    const userRole = (token as any)?.membershipRole

    return await withTenantContext({ tenantId, userId, role: userRole, userRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId)
      
      // Get the existing order (tenant filter applied by middleware)
      const existingOrder = await prisma.order.findFirst({
        where: { orderId: body.orderId }
      })
      
      if (!existingOrder) {
        console.error('[orders/status] SECURITY: Order not found or wrong tenant', { 
          orderId: body.orderId, 
          tenantId,
          attemptedBy: userId 
        });
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      // Update the order status
      const updatedOrder = await prisma.order.update({
        where: { id: existingOrder.id },
        data: { status: body.status }
      })

      // Log audit trail (non-blocking)
      try {
        console.log('[orders/status] Status update:', {
          orderId: body.orderId,
          oldStatus: existingOrder.status,
          newStatus: body.status,
          userId
        })
        await logUpdate(request as any, 'order', updatedOrder.id, `Order #${body.orderId}`, 
          { status: existingOrder.status }, 
          { status: body.status })
      } catch (auditError) {
        console.error('[orders/status] Audit logging failed (non-fatal):', auditError)
      }

      return NextResponse.json({ success: true, data: updatedOrder })
    })
  } catch (error) {
    console.error('[orders/status] Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: process.env.NODE_ENV !== 'production' ? errorMessage : undefined
      },
      { status: 500 }
    )
  }
}