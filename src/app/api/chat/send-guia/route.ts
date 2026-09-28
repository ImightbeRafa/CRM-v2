import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatSendRateLimit, createIdentifierRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/auditLogger'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { CHAT_OUTBOUND_MEDIA_FLAG } from '@/lib/chat-outbound-media'
import { normalizeClientPhone } from '@/lib/order-lifecycle'
import { sendWhatsAppMediaBytes } from '@/lib/chat-send-media-core'
import { guiaCaption, guiaPdfFilename, maskPhone } from '@/lib/chat-order-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const guiaSendRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  identifier: 'chat-send-media',
})

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

/**
 * POST /api/chat/send-guia { conversationId, orderId } — sends the order's latest Correos guía
 * PDF to the customer of this WhatsApp chat. The order must belong to this chat (created from
 * it, the linked client's, or the same phone) so a label never goes to the wrong person.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId, userId } = auth

    if (!(await isTenantFeatureNotDisabled(tenantId, CHAT_OUTBOUND_MEDIA_FLAG))) {
      return jsonError('El envío de archivos está desactivado para este negocio.', 403)
    }
    for (const limiter of [chatSendRateLimit, guiaSendRateLimit]) {
      const rate = await limiter(`${tenantId}:${userId}`)
      if (!rate.allowed) {
        return NextResponse.json({ error: 'Demasiados envíos. Esperá un momento.' }, { status: 429, headers: rate.headers })
      }
    }

    const body = (await request.json().catch(() => null)) as {
      conversationId?: unknown
      orderId?: unknown
      confirm?: unknown
      resend?: unknown
    } | null
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : ''
    const orderId = typeof body?.orderId === 'string' ? body.orderId : ''
    if (!conversationId || !orderId) return jsonError('Faltan el chat o el pedido.', 400)

    const conversation = await prisma.chatConversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true, peerId: true, peerName: true, clientId: true, socialAccountId: true, socialAccount: { select: { platform: true } } },
    })
    if (!conversation) return jsonError('Chat no encontrado', 404)
    if (conversation.socialAccount?.platform !== 'whatsapp') {
      return jsonError('Por ahora la guía solo se puede enviar por WhatsApp.', 400)
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: { id: true, orderId: true, customerName: true, phone: true, clientId: true },
    })
    if (!order) return jsonError('Pedido no encontrado', 404)

    const linkedFromChat = await prisma.chatMessage.findFirst({
      where: { tenantId, conversationId: conversation.id, orderId: order.id },
      select: { id: true },
    })
    const samePhone =
      normalizeClientPhone(order.phone) !== null && normalizeClientPhone(order.phone) === normalizeClientPhone(conversation.peerId)
    const sameClient = Boolean(order.clientId && conversation.clientId && order.clientId === conversation.clientId)
    if (!linkedFromChat && !samePhone && !sameClient) {
      return jsonError('Este pedido no es de este chat.', 403)
    }
    // The label has the customer's name, address and phone. Links set by hand (order-link,
    // Cliente) are human claims: another number needs an explicit confirmation in the UI.
    if (!samePhone && body?.confirm !== true) {
      return NextResponse.json(
        {
          error: 'El teléfono del pedido no es el de este chat. Confirmá antes de enviar la guía.',
          code: 'confirm_required',
          customerName: order.customerName,
          phoneMasked: maskPhone(order.phone),
        },
        { status: 409 },
      )
    }

    const guia = await prisma.shippingGuia.findFirst({
      where: { tenantId, orderId: order.orderId, pdfData: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, guiaNumber: true, trackingNumber: true, pdfData: true, pdfFileName: true },
    })
    if (!guia?.pdfData) return jsonError('Este pedido todavía no tiene guía generada.', 404)

    const number = guia.guiaNumber || guia.trackingNumber || null
    const result = await sendWhatsAppMediaBytes({
      tenantId,
      userId,
      socialAccountId: conversation.socialAccountId,
      recipient: conversation.peerId,
      bytes: new Uint8Array(guia.pdfData),
      filename: guiaPdfFilename(number, order.orderId),
      caption: guiaCaption({ customerName: conversation.peerName || order.customerName, orderNumber: order.orderId, guiaNumber: number }),
      // Same guía to the same chat is deduplicated (double click); "Reenviar" is a new send.
      clientRequestId: body?.resend === true ? `guia:${guia.id}:${conversation.id}:${Date.now()}` : `guia:${guia.id}:${conversation.id}`,
      metadata: { guiaId: guia.id, orderId: order.id },
    })
    if (!result.ok) return NextResponse.json({ error: result.error, ...result.extra }, { status: result.status })

    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'ChatConversation',
      entityId: conversation.id,
      description: `Guía enviada al cliente (pedido ${order.orderId})`,
      newValues: {
        orderId: order.id,
        guiaId: guia.id,
        match: samePhone ? 'phone' : linkedFromChat ? 'chat_link' : 'client_link',
        confirmed: !samePhone,
        duplicate: result.duplicate === true,
      },
      userId,
      userRole: auth.role,
      tenantId,
    }).catch(() => {})

    // The guía message also links the order to this chat (Chat→pedido stats, rail).
    if (result.message?.id) {
      await prisma.chatMessage
        .updateMany({ where: { id: result.message.id, tenantId, orderId: null }, data: { orderId: order.id } })
        .catch(() => {})
    }
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate === true,
      message: result.message,
      conversationId: result.conversationId,
    })
  } catch (error) {
    console.error('[chat/send-guia] Internal error', error)
    return jsonError('Error interno al enviar la guía', 500)
  }
}
