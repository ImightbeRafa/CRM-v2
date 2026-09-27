import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isAlreadyLinked, parseOrderLinkBody, pickLinkTarget } from '@/lib/chat-order-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/chat/order-link
 * Links an existing order to a chat thread by setting `ChatMessage.orderId` on the thread's
 * latest unlinked inbound message. Tenant-scoped, idempotent, and never overwrites another
 * order's link. Same permission gate as the inbox and `/api/chat/send`.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json({ error: 'Cuerpo de solicitud inválido (JSON requerido)' }, { status: 400 })
    }
    const body = parseOrderLinkBody(json)
    if (!body) {
      return NextResponse.json({ error: 'Faltan datos para vincular el pedido al chat' }, { status: 400 })
    }

    const db = prisma as any

    const account = await db.socialAccount.findFirst({
      where: { id: body.socialAccountId, tenantId },
      select: { id: true },
    })
    if (!account) {
      return NextResponse.json({ error: 'Línea no encontrada' }, { status: 404 })
    }

    const order = await db.order.findFirst({
      where: { tenantId, OR: [{ id: body.order }, { orderId: body.order }] },
      select: { id: true, orderId: true },
    })
    if (!order) {
      return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 })
    }

    const conversation = await db.chatConversation.findFirst({
      where: { tenantId, socialAccountId: account.id, peerId: body.peerId },
      select: { id: true },
    })

    const threadFilter = [
      ...(conversation ? [{ conversationId: conversation.id }] : []),
      { peerId: body.peerId },
    ]
    const loadThread = () =>
      db.chatMessage.findMany({
        where: { tenantId, socialAccountId: account.id, OR: threadFilter },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: { id: true, direction: true, orderId: true },
      })

    const messages = await loadThread()
    if (isAlreadyLinked(messages, order.id)) {
      return NextResponse.json({ linked: true, already: true, orderId: order.orderId })
    }

    const target = pickLinkTarget(messages)
    if (!target) {
      return NextResponse.json({ error: 'Este chat no tiene mensajes para vincular' }, { status: 409 })
    }

    // Conditional write: only a message that still has no order. Race-safe, never overwrites.
    const written = await db.chatMessage.updateMany({
      where: { id: target.id, tenantId, orderId: null },
      data: { orderId: order.id },
    })
    if (written.count === 0) {
      const latest = await loadThread()
      if (isAlreadyLinked(latest, order.id)) {
        return NextResponse.json({ linked: true, already: true, orderId: order.orderId })
      }
      return NextResponse.json({ error: 'No se pudo vincular; intentá de nuevo' }, { status: 409 })
    }

    return NextResponse.json({ linked: true, messageId: target.id, orderId: order.orderId })
  } catch (error) {
    console.error('[chat/order-link POST]', error)
    return NextResponse.json({ error: 'No se pudo vincular el pedido al chat' }, { status: 500 })
  }
}
