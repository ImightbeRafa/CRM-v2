import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatSendRateLimit, createIdentifierRateLimit } from '@/lib/rate-limit'
import { isTenantFeatureNotDisabled } from '@/lib/feature-flags'
import { CHAT_OUTBOUND_MEDIA_FLAG, WA_OUTBOUND_LIMITS } from '@/lib/chat-outbound-media'
import { filenameForMime, loadStoredChatMediaBytes, sendWhatsAppMediaBytes, type SendMediaResult } from '@/lib/chat-send-media-core'
import { readChatMediaFromBlob } from '@/lib/chat-media'
import { isQuickReplyMediaPath, quickRepliesFromSettings, quickReplyMediaPaths } from '@/lib/chat-quick-replies'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stays below Next's 10 MB middleware body copy (see OUTBOUND_UPLOAD_CAP).
const MAX_REQUEST_BYTES = WA_OUTBOUND_LIMITS.document + 256 * 1024

const chatMediaSendRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  identifier: 'chat-send-media',
})

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

function toResponse(result: SendMediaResult, clientRequestId: string | null) {
  if (!result.ok) return jsonError(result.error, result.status, result.extra)
  return NextResponse.json({
    success: true,
    ...(result.duplicate ? { duplicate: true } : {}),
    message: result.message,
    conversationId: result.conversationId,
    clientRequestId,
  })
}

function cleanRequestId(raw: unknown): string | null {
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9._:-]{1,80}$/.test(value) ? value : null
}

/**
 * POST /api/chat/send-media
 * - multipart: file, socialAccountId, recipient, caption?, clientRequestId?
 * - JSON: { sourceMessageId, socialAccountId, recipient, caption?, clientRequestId? } re-sends a
 *   file already stored in this business's chats ("Recientes"), no new upload from the browser.
 * WhatsApp only for now: upload to /{phone_number_id}/media, then send by media id.
 * Media is only allowed inside the 24 h window (Meta enforces; its error is returned as-is).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId, userId } = auth

    if (!(await isTenantFeatureNotDisabled(tenantId, CHAT_OUTBOUND_MEDIA_FLAG))) {
      return jsonError('El envío de archivos está desactivado para este negocio.', 403)
    }

    for (const limiter of [chatSendRateLimit, chatMediaSendRateLimit]) {
      const rate = await limiter(`${tenantId}:${userId}`)
      if (!rate.allowed) {
        return NextResponse.json(
          { error: 'Demasiados envíos. Esperá un momento e intentá de nuevo.' },
          { status: 429, headers: rate.headers },
        )
      }
    }

    if ((request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      if (Number(request.headers.get('content-length') || 0) > 8 * 1024) return jsonError('Solicitud demasiado grande.', 413)
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
      const sourceMessageId = String(body?.sourceMessageId || '').trim()
      const quickReplyMediaPath = body?.quickReplyMediaPath
      const socialAccountId = String(body?.socialAccountId || '')
      const recipient = String(body?.recipient || '').trim()
      const clientRequestId = cleanRequestId(body?.clientRequestId)
      if ((!sourceMessageId && !quickReplyMediaPath) || !socialAccountId || !recipient || recipient === 'unknown') {
        return jsonError('Faltan el archivo, la línea o el destinatario.', 400)
      }
      // A file saved with a quick reply (this business's private path only).
      if (quickReplyMediaPath) {
        if (!isQuickReplyMediaPath(quickReplyMediaPath, tenantId)) return jsonError('Archivo no encontrado', 404)
        // Only files still attached to one of the business's quick replies.
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
        if (!quickReplyMediaPaths(quickRepliesFromSettings(tenant?.settings)).has(quickReplyMediaPath)) {
          return jsonError('Ese archivo ya no está en las respuestas rápidas.', 404)
        }
        let stored: { bytes: Buffer; contentType: string | null }
        try {
          stored = await readChatMediaFromBlob({ pathname: quickReplyMediaPath })
        } catch {
          return jsonError('El archivo de la respuesta rápida ya no está disponible.', 404)
        }
        if (stored.bytes.length > MAX_REQUEST_BYTES) return jsonError('El archivo es demasiado grande.', 413)
        const result = await sendWhatsAppMediaBytes({
          tenantId,
          userId,
          socialAccountId,
          recipient,
          bytes: new Uint8Array(stored.bytes),
          filename: filenameForMime(String(body?.filename || '').slice(0, 120) || quickReplyMediaPath.split('/').pop(), stored.contentType, 'archivo'),
          caption: String(body?.caption || ''),
          clientRequestId,
          metadata: { quickReplyMedia: true, quickReplyMediaPath },
        })
        return toResponse(result, clientRequestId)
      }
      const source = await loadStoredChatMediaBytes(tenantId, sourceMessageId)
      if (!source.ok) return jsonError(source.error, source.status)
      if (source.bytes.length > MAX_REQUEST_BYTES) return jsonError('El archivo es demasiado grande.', 413)
      const result = await sendWhatsAppMediaBytes({
        tenantId,
        userId,
        socialAccountId,
        recipient,
        bytes: new Uint8Array(source.bytes),
        filename: filenameForMime(source.filename, source.mime, 'imagen'),
        caption: String(body?.caption || ''),
        clientRequestId,
        metadata: { reusedFromMessageId: sourceMessageId },
      })
      return toResponse(result, clientRequestId)
    }

    // A declared size is required: never buffer an unbounded (chunked) body.
    const declared = Number(request.headers.get('content-length') || 0)
    if (!declared) return jsonError('Falta el tamaño del archivo.', 411)
    if (declared > MAX_REQUEST_BYTES) {
      return jsonError('El archivo supera el máximo de 9 MB.', 413)
    }

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return jsonError('Solicitud inválida (se esperaba un archivo).', 400)
    }
    const file = form.get('file')
    const socialAccountId = String(form.get('socialAccountId') || '')
    const recipient = String(form.get('recipient') || '').trim()
    const clientRequestId = cleanRequestId(form.get('clientRequestId'))

    if (!(file instanceof Blob) || !socialAccountId || !recipient || recipient === 'unknown') {
      return jsonError('Faltan el archivo, la línea o el destinatario.', 400)
    }
    if (file.size > MAX_REQUEST_BYTES) return jsonError('El archivo es demasiado grande.', 413)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const filename = typeof (file as File).name === 'string' ? (file as File).name : 'archivo'
    const result = await sendWhatsAppMediaBytes({
      tenantId,
      userId,
      socialAccountId,
      recipient,
      bytes,
      filename,
      caption: String(form.get('caption') || ''),
      clientRequestId,
    })
    return toResponse(result, clientRequestId)
  } catch (error) {
    console.error('[chat/send-media] Internal error', error)
    return jsonError('Error interno al enviar el archivo', 500)
  }
}
