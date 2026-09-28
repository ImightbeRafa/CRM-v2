import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { chatSendRateLimit, createIdentifierRateLimit } from '@/lib/rate-limit'
import { isTenantFeatureEnabled } from '@/lib/feature-flags'
import { socialTokenSendBlockMessage } from '@/lib/social-account-token-health'
import {
  dualWriteChatMessage,
  finalizeOutboundDelivery,
  isPersistedDualWrite,
} from '@/lib/chat-conversation-write'
import { mapMessageToDto } from '@/lib/chat-conversation-api'
import { buildHumanSenderSnapshot, mergeHumanSenderMetadata } from '@/lib/chat-human-attribution'
import { autoAssignOnFirstHumanReply } from '@/lib/chat-auto-assign'
import { buildMediaCacheMetadataPatch, putChatMediaToBlob } from '@/lib/chat-media'
import {
  CHAT_OUTBOUND_MEDIA_FLAG,
  WA_OUTBOUND_LIMITS,
  buildWhatsAppMediaMessage,
  classifyOutboundMedia,
  outboundMediaContent,
} from '@/lib/chat-outbound-media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = WA_OUTBOUND_LIMITS.document + 512 * 1024
const META_TIMEOUT_MS = 30_000

const chatMediaSendRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 10,
  identifier: 'chat-send-media',
})

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return text.trim() ? JSON.parse(text) : {}
  } catch {
    return { error: { message: 'Respuesta no JSON de Meta' } }
  }
}

/**
 * POST /api/chat/send-media (multipart: file, socialAccountId, recipient, caption?, clientRequestId?)
 * WhatsApp only for now: upload to /{phone_number_id}/media, then send by media id.
 * Media is only allowed inside the 24 h window (Meta enforces; its error is returned as-is).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId, userId } = auth
    const db = prisma as any

    if (!(await isTenantFeatureEnabled(tenantId, CHAT_OUTBOUND_MEDIA_FLAG))) {
      return jsonError('El envío de archivos todavía no está activado para este negocio.', 403)
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

    const declared = Number(request.headers.get('content-length') || 0)
    if (declared && declared > MAX_REQUEST_BYTES) {
      return jsonError('El archivo es demasiado grande.', 413)
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
    const caption = String(form.get('caption') || '').slice(0, 1024)
    const rawRequestId = String(form.get('clientRequestId') || '').trim()
    const clientRequestId = /^[A-Za-z0-9._:-]{1,80}$/.test(rawRequestId) ? rawRequestId : null

    if (!(file instanceof Blob) || !socialAccountId || !recipient || recipient === 'unknown') {
      return jsonError('Faltan el archivo, la línea o el destinatario.', 400)
    }
    if (file.size > MAX_REQUEST_BYTES) return jsonError('El archivo es demasiado grande.', 413)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const filename = typeof (file as File).name === 'string' ? (file as File).name : 'archivo'
    const media = classifyOutboundMedia({ filename, bytes })
    if (!media.ok) return jsonError(media.error, 400)

    // Retry of a file that already went out (same pending file → same clientRequestId): no re-send.
    if (clientRequestId) {
      const already = await db.chatMessage.findFirst({
        where: {
          tenantId,
          socialAccountId,
          direction: 'outbound',
          sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          metadata: { path: ['clientRequestId'], equals: clientRequestId },
        },
      })
      if (already) {
        return NextResponse.json({ success: true, duplicate: true, message: mapMessageToDto(already), clientRequestId })
      }
    }

    const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
    if (!found) return jsonError('Línea no encontrada', 404)
    if (found.platform !== 'whatsapp') {
      return jsonError('Por ahora solo se pueden enviar archivos por WhatsApp.', 400)
    }
    const tokenStatus = String(found.tokenStatus || '').toLowerCase()
    if (found.isActive === false || found.disconnectedAt || tokenStatus === 'revoked' || tokenStatus === 'expired') {
      return jsonError(socialTokenSendBlockMessage(found), 400)
    }
    const accessToken = decryptSocialAccessToken(found.accessToken)
    if (!accessToken) return jsonError('Falta el token de WhatsApp. Reconectá la línea en Canales.', 400)

    // 1) Upload the file to Meta → media id.
    const upload = new FormData()
    upload.append('messaging_product', 'whatsapp')
    upload.append('type', media.mime)
    upload.append('file', new Blob([bytes], { type: media.mime }), media.filename)
    const uploadUrl = addAppSecretProofToUrl(buildMetaGraphUrl(`${found.accountId}/media`), accessToken, {
      purpose: 'whatsapp',
    })
    const upRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: upload,
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const upData = await readJson(upRes)
    const mediaId = typeof upData?.id === 'string' ? upData.id : null
    if (!upRes.ok || !mediaId) {
      console.error('[chat/send-media] upload failed', { status: upRes.status, error: upData?.error?.message })
      return jsonError(upData?.error?.message || 'WhatsApp no aceptó el archivo.', 502)
    }

    // 2) Send the message by media id.
    const sendUrl = addAppSecretProofToUrl(buildMetaGraphUrl(`${found.accountId}/messages`), accessToken, {
      purpose: 'whatsapp',
    })
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildWhatsAppMediaMessage({ to: recipient, kind: media.kind, mediaId, caption, filename: media.filename }),
      ),
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    })
    const sendData = await readJson(sendRes)
    if (!sendRes.ok) {
      console.error('[chat/send-media] send failed', { status: sendRes.status, error: sendData?.error?.message })
      return jsonError(sendData?.error?.message || 'Falló el envío por WhatsApp', 502)
    }
    const providerMessageId: string | undefined = sendData?.messages?.[0]?.id

    // 3) Persist like a human text send (attribution, conversation, delivery).
    const senderUser = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, username: true, email: true, image: true },
    })
    const snapshot = buildHumanSenderSnapshot({
      userId,
      name: senderUser?.name,
      username: senderUser?.username,
      email: senderUser?.email,
      image: senderUser?.image,
    })
    const write = await dualWriteChatMessage({
      tenantId,
      socialAccountId: found.id,
      direction: 'outbound',
      content: outboundMediaContent(media.kind, caption),
      sentAt: new Date(),
      receivedAt: null,
      peerId: recipient,
      providerMessageId: providerMessageId || null,
      messageType: media.kind,
      deliveryStatus: 'pending',
      platform: 'whatsapp',
      senderUserId: userId,
      providerMediaId: mediaId,
      mediaMimeType: media.mime,
      mediaFilename: media.filename,
      metadata: mergeHumanSenderMetadata(
        {
          to: recipient,
          provider: 'whatsapp',
          platform: 'whatsapp',
          messageType: media.kind,
          ...(clientRequestId ? { clientRequestId } : {}),
        },
        snapshot,
      ),
      suppressSoftAi: true,
    })
    if (!isPersistedDualWrite(write)) {
      return jsonError('El archivo se envió pero no se pudo guardar en Betsy.', 500, { sent: true })
    }

    // 4) Private copy for the thread (the uploaded media id also works for ~30 days).
    try {
      const stored = await putChatMediaToBlob({
        tenantId,
        messageId: write.messageId,
        bytes: Buffer.from(bytes),
        contentType: media.mime,
      })
      const ref = {
        mediaBlobPath: stored.pathname,
        mediaCacheStatus: 'ready' as const,
        mediaMimeType: media.mime,
        mediaFilename: media.filename,
      }
      const row = await db.chatMessage.findFirst({ where: { id: write.messageId, tenantId }, select: { metadata: true } })
      const meta = row?.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {}
      await db.chatMessage.updateMany({
        where: { id: write.messageId, tenantId },
        data: {
          mediaBlobPath: stored.pathname,
          mediaCacheStatus: 'ready',
          mediaSizeBytes: media.size,
          mediaCachedAt: new Date(),
          metadata: buildMediaCacheMetadataPatch(meta, ref) as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      console.warn('[chat/send-media] blob cache skipped', error instanceof Error ? error.message : error)
    }

    await finalizeOutboundDelivery({
      messageId: write.messageId,
      tenantId,
      conversationId: write.conversationId,
      userId,
      providerMessageId: providerMessageId || null,
      deliveryStatus: providerMessageId ? 'sent' : 'failed',
      errorCode: providerMessageId ? null : 'missing_provider_message_id',
      providerResponse: sendData,
    })

    if (providerMessageId && write.conversationId && senderUser) {
      await autoAssignOnFirstHumanReply(db, { tenantId, conversationId: write.conversationId, userId })
    }

    const saved = await db.chatMessage.findFirst({ where: { id: write.messageId, tenantId } })
    return NextResponse.json({
      success: true,
      message: saved ? mapMessageToDto(saved) : null,
      conversationId: write.conversationId,
      clientRequestId,
    })
  } catch (error) {
    console.error('[chat/send-media] Internal error', error)
    return jsonError('Error interno al enviar el archivo', 500)
  }
}
