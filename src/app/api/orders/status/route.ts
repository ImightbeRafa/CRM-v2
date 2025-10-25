import { NextResponse } from 'next/server'
import { logUpdate } from '@/lib/auditLogger'
import { withTenantContext } from '@/lib/tenantContext'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { getToken } from 'next-auth/jwt'

export const runtime = 'nodejs'

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

    return await withTenantContext({ tenantId, userId: userId || 'system', role: (token as any)?.membershipRole, userRole: (token as any)?.membershipRole, userName }, async () => {
      const prisma = getTenantPrisma(tenantId)

      // Get the existing order for audit logging with tenant filter
      const existingOrder = await prisma.order.findFirst({
        where: { orderId: body.orderId, tenantId }
      })

      if (!existingOrder) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      const updatedOrder = await prisma.order.update({
        where: { id: existingOrder.id },
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
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}