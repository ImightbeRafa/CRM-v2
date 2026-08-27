import { NextResponse } from 'next/server'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { withTenantContext } from '@/lib/tenantContext'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logUpdate } from '@/lib/auditLogger'
import { shouldUseOrderLifecycleV2 } from '@/lib/feature-flags'
import { confirmLifecycleCashPayment, lifecycleIdempotencyKey, OrderLifecycleError } from '@/lib/order-lifecycle'

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

    const auth = await authenticateAPIWithPermission(request as any, 'update_production')
    if (!auth.ok) return auth.response
    const { tenantId, userId, role: userRole } = auth
    const userName = 'Authenticated user'

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

      const useLifecycleV2 = await shouldUseOrderLifecycleV2(tenantId, 'ce-confirmation')

      if (existingOrder.cePaymentConfirmed && !useLifecycleV2) {
        return NextResponse.json(
          { error: 'Payment already confirmed' },
          { status: 400 }
        )
      }

      let updatedOrder
      if (useLifecycleV2) {
        try {
          const lifecycle = await confirmLifecycleCashPayment({
            tenantId,
            userId,
            idempotencyKey: lifecycleIdempotencyKey(request, `ce-confirm:${existingOrder.id}`),
            orderId: existingOrder.orderId,
          })
          updatedOrder = lifecycle.order
        } catch (error) {
          if (error instanceof OrderLifecycleError) {
            return NextResponse.json({ error: error.message }, { status: error.status })
          }
          throw error
        }
      } else {
        updatedOrder = await prisma.order.update({
          where: { id: existingOrder.id },
          data: { cePaymentConfirmed: true }
        })
      }

      if (!useLifecycleV2) try {
        await logUpdate(request as any, 'order', updatedOrder.id, `Order #${body.orderId}`,
          {
            cePaymentConfirmed: false,
            changes: ['Pago CE confirmado: "No" → "Sí"'],
          },
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
