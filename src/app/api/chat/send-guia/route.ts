import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatSendRateLimit, createIdentifierRateLimit } from '@/lib/rate-limit'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { CHAT_OUTBOUND_MEDIA_FLAG } from '@/lib/chat-outbound-media'
import { sendGuiaToChat } from '@/lib/shipping/send-guia-to-chat'
import { isSameOriginRequest } from '@/lib/same-origin'

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
    if (!isSameOriginRequest(request)) return jsonError('Origen no permitido.', 403)
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

    const result = await sendGuiaToChat({
      tenantId,
      userId,
      userRole: auth.role,
      conversationId,
      orderId,
      confirm: body?.confirm === true,
      resend: body?.resend === true,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error, ...(result.code ? { code: result.code } : {}), ...result.extra }, { status: result.status })
    }
    return NextResponse.json({
      success: true,
      duplicate: result.duplicate,
      message: result.message,
      conversationId: result.conversationId,
    })
  } catch (error) {
    console.error('[chat/send-guia] Internal error', error)
    return jsonError('Error interno al enviar la guía', 500)
  }
}
