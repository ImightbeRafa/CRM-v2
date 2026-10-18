import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getTenantPrisma } from '@/lib/prisma-tenant'
import { withTenantContext } from '@/lib/tenantContext'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logUpdate } from '@/lib/auditLogger'
import { shouldUseOrderLifecycleV2 } from '@/lib/feature-flags'
import {
  confirmLifecycleCashPayment,
  confirmLifecycleSinpePayment,
  lifecycleIdempotencyKey,
  OrderLifecycleError,
} from '@/lib/order-lifecycle'
import { sinpeConfirmationPatch } from '@/lib/order-payment-status'
import { isSameOriginJson } from '@/lib/same-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginJson(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || typeof body.orderId !== 'string' || !body.orderId.trim()) {
      return NextResponse.json(
        { error: 'Missing required field: orderId' },
        { status: 400 }
      )
    }

    const paymentType = body.paymentType == null || body.paymentType === 'contra_entrega'
      ? 'contra_entrega'
      : body.paymentType === 'sinpe'
        ? 'sinpe'
        : null
    if (!paymentType) {
      return NextResponse.json({ error: 'Tipo de pago no válido' }, { status: 400 })
    }

    const auth = await authenticateAPIWithPermission(request, 'update_production')
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

      if (paymentType === 'sinpe') {
        return confirmSinpePayment(request, prisma, existingOrder, { tenantId, userId })
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
        await logUpdate(request, 'order', updatedOrder.id, `Order #${body.orderId}`,
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

async function confirmSinpePayment(
  request: NextRequest,
  prisma: ReturnType<typeof getTenantPrisma>,
  existingOrder: {
    id: string
    orderId: string
    status: string | null
    contraEntrega: boolean | null
    cePaymentConfirmed: boolean | null
    comments: string | null
    customFields: unknown
    updatedAt: Date
  },
  actor: { tenantId: string; userId: string },
) {
  const decision = sinpeConfirmationPatch(existingOrder)
  if (!decision.ok) {
    return NextResponse.json({ error: decision.message }, { status: 400 })
  }

  const useLifecycleV2 = await shouldUseOrderLifecycleV2(actor.tenantId, 'sinpe-confirmation')
  if (useLifecycleV2) {
    try {
      await confirmLifecycleSinpePayment({
        tenantId: actor.tenantId,
        userId: actor.userId,
        idempotencyKey: lifecycleIdempotencyKey(request, `sinpe-confirm:${existingOrder.id}:${existingOrder.updatedAt.toISOString()}`),
        orderId: existingOrder.orderId,
      })
    } catch (error) {
      if (error instanceof OrderLifecycleError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
    return NextResponse.json({ success: true, paymentStatus: 'paid' })
  }

  const changed = await prisma.order.updateMany({
    where: { id: existingOrder.id, updatedAt: existingOrder.updatedAt },
    data: { customFields: decision.customFields as Prisma.InputJsonValue },
  })
  if (changed.count !== 1) {
    const again = await prisma.order.findFirst({ where: { id: existingOrder.id } })
    const againDecision = again ? sinpeConfirmationPatch(again) : null
    if (againDecision && !againDecision.ok && againDecision.code === 'already_paid') {
      return NextResponse.json({ error: againDecision.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'El pedido cambió antes de confirmar el pago' }, { status: 409 })
  }

  try {
    await logUpdate(
      request,
      'order',
      existingOrder.id,
      `Order #${existingOrder.orderId}`,
      { paymentStatus: decision.previousStatus },
      { paymentStatus: 'paid' },
    )
  } catch (auditError) {
    console.error('[confirm-payment] Audit logging failed (non-fatal):', auditError)
  }

  return NextResponse.json({ success: true, paymentStatus: 'paid' })
}
