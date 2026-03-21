import { NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { withTenantContext } from '@/lib/tenantContext'
import { getToken } from 'next-auth/jwt'
import { logUpdate } from '@/lib/auditLogger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    if (!body.orderId) {
      return NextResponse.json(
        { error: 'Missing required field: orderId' },
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

      const existingOrder = await prisma.order.findFirst({
        where: { orderId: body.orderId }
      })

      if (!existingOrder) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }

      if (!existingOrder.contraEntrega) {
        return NextResponse.json(
          { error: 'Order is not contra entrega' },
          { status: 400 }
        )
      }

      if (existingOrder.cePaymentConfirmed) {
        return NextResponse.json(
          { error: 'Payment already confirmed' },
          { status: 400 }
        )
      }

      const updatedOrder = await prisma.order.update({
        where: { id: existingOrder.id },
        data: { cePaymentConfirmed: true }
      })

      try {
        await logUpdate(request as any, 'order', updatedOrder.id, `Order #${body.orderId}`,
          { cePaymentConfirmed: false },
          { cePaymentConfirmed: true })
      } catch (auditError) {
        console.error('[confirm-payment] Audit logging failed (non-fatal):', auditError)
      }

      return NextResponse.json({ success: true, data: updatedOrder })
    })
  } catch (error) {
    console.error('[confirm-payment] Error:', error)
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
