/**
 * Send an order's latest Correos guía PDF to the customer of a WhatsApp chat — shared by the Chats "Enviar guía"
 * button (/api/chat/send-guia) and, from F7, the automatic guía after a human approves a payment.
 * The order must belong to the chat (linked to it, same phone, or the chat's client); a phone that differs needs
 * an explicit confirm (the label carries the customer's name, address and phone).
 * Callers own auth / permission / rate limits; this function owns the ownership rule, the send and the audit.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { recordActivity } from '@/lib/activity'
import { logAuditEvent } from '@/lib/auditLogger'
import { normalizeClientPhone } from '@/lib/order-lifecycle'
import { sendWhatsAppMediaBytes } from '@/lib/chat-send-media-core'
import { guiaCaption, guiaPdfFilename, maskPhone } from '@/lib/chat-order-flow'

export type SendGuiaToChatInput = {
  tenantId: string
  userId: string
  userRole: string
  conversationId: string
  orderId: string
  /** The person confirmed sending although the order's phone is not the chat's. */
  confirm?: boolean
  /** "Reenviar": a new send instead of the deduplicated one. */
  resend?: boolean
}

export type SendGuiaToChatResult =
  | {
      ok: true
      duplicate: boolean
      message: unknown
      conversationId: unknown
    }
  | {
      ok: false
      status: number
      error: string
      code?: string
      extra?: Record<string, unknown>
    }

export async function sendGuiaToChat(input: SendGuiaToChatInput): Promise<SendGuiaToChatResult> {
  const { tenantId, userId } = input
  const conversation = await prisma.chatConversation.findFirst({
    where: { id: input.conversationId, tenantId },
    select: { id: true, peerId: true, peerName: true, clientId: true, socialAccountId: true, socialAccount: { select: { platform: true } } },
  })
  if (!conversation) return { ok: false, status: 404, error: 'Chat no encontrado' }
  if (conversation.socialAccount?.platform !== 'whatsapp') {
    return { ok: false, status: 400, error: 'Por ahora la guía solo se puede enviar por WhatsApp.' }
  }

  const order = await prisma.order.findFirst({
    where: { id: input.orderId, tenantId, deletedAt: null },
    select: { id: true, orderId: true, customerName: true, phone: true, clientId: true },
  })
  if (!order) return { ok: false, status: 404, error: 'Pedido no encontrado' }

  const linkedFromChat = await prisma.chatMessage.findFirst({
    where: { tenantId, conversationId: conversation.id, orderId: order.id },
    select: { id: true },
  })
  const samePhone =
    normalizeClientPhone(order.phone) !== null && normalizeClientPhone(order.phone) === normalizeClientPhone(conversation.peerId)
  const sameClient = Boolean(order.clientId && conversation.clientId && order.clientId === conversation.clientId)
  if (!linkedFromChat && !samePhone && !sameClient) {
    return { ok: false, status: 403, error: 'Este pedido no es de este chat.' }
  }
  // The label has the customer's name, address and phone. Links set by hand (order-link,
  // Cliente) are human claims: another number needs an explicit confirmation in the UI.
  if (!samePhone && input.confirm !== true) {
    return {
      ok: false,
      status: 409,
      error: 'El teléfono del pedido no es el de este chat. Confirmá antes de enviar la guía.',
      code: 'confirm_required',
      extra: { customerName: order.customerName, phoneMasked: maskPhone(order.phone) },
    }
  }

  const guia = await prisma.shippingGuia.findFirst({
    where: { tenantId, orderId: order.orderId, pdfData: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, guiaNumber: true, trackingNumber: true, pdfData: true, pdfFileName: true },
  })
  if (!guia?.pdfData) return { ok: false, status: 404, error: 'Este pedido todavía no tiene guía generada.' }

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
    clientRequestId: input.resend === true ? `guia:${guia.id}:${conversation.id}:${Date.now()}` : `guia:${guia.id}:${conversation.id}`,
    metadata: { guiaId: guia.id, orderId: order.id },
  })
  if (!result.ok) return { ok: false, status: result.status, error: result.error, extra: result.extra }

  const match = samePhone ? 'phone' : linkedFromChat ? 'chat_link' : 'client_link'
  void recordActivity({
    tenantId,
    actorUserId: userId,
    verb: 'guia.send_chat',
    entityType: 'Order',
    entityId: order.id,
    orderId: order.id,
    conversationId: conversation.id,
    clientId: conversation.clientId ?? order.clientId ?? null,
    surface: 'chats',
    props: { match },
  })

  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    description: `Guía enviada al cliente (pedido ${order.orderId})`,
    newValues: {
      orderId: order.id,
      guiaId: guia.id,
      match,
      confirmed: !samePhone,
      duplicate: result.duplicate === true,
    },
    userId,
    userRole: input.userRole,
    tenantId,
  }).catch(() => {})

  // The guía message also links the order to this chat (Chat→pedido stats, rail).
  if (result.message?.id) {
    await prisma.chatMessage
      .updateMany({ where: { id: result.message.id, tenantId, orderId: null }, data: { orderId: order.id } })
      .catch(() => {})
  }
  return { ok: true, duplicate: result.duplicate === true, message: result.message, conversationId: result.conversationId }
}
