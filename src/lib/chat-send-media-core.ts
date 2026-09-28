import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { socialTokenSendBlockMessage } from '@/lib/social-account-token-health'
import {
  dualWriteChatMessage,
  finalizeOutboundDelivery,
  isPersistedDualWrite,
} from '@/lib/chat-conversation-write'
import { mapMessageToDto } from '@/lib/chat-conversation-api'
import { buildHumanSenderSnapshot, mergeHumanSenderMetadata } from '@/lib/chat-human-attribution'
import { autoAssignOnFirstHumanReply } from '@/lib/chat-auto-assign'
import {
  buildMediaCacheMetadataPatch,
  cacheProviderMediaToBlob,
  putChatMediaToBlob,
  readChatMediaFromBlob,
  readMediaBlobRefFromMessage,
} from '@/lib/chat-media'
import { buildWhatsAppMediaMessage, classifyOutboundMedia, outboundMediaContent } from '@/lib/chat-outbound-media'

const META_TIMEOUT_MS = 30_000

export type SendMediaResult =
  | { ok: true; message: ReturnType<typeof mapMessageToDto> | null; conversationId: string | null; duplicate?: boolean }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> }

async function readJson(res: Response): Promise<any> {
  const text = await res.text()
  try {
    return text.trim() ? JSON.parse(text) : {}
  } catch {
    return { error: { message: 'Respuesta no JSON de Meta' } }
  }
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
}

/** Filename with an extension that matches the bytes' declared type (classification needs one). */
export function filenameForMime(name: string | null | undefined, mime: string | null | undefined, fallback = 'archivo'): string {
  const clean = String(name || '').trim()
  if (/\.[a-z0-9]{2,5}$/i.test(clean)) return clean
  const ext = EXT_BY_MIME[String(mime || '').split(';')[0].trim().toLowerCase()]
  return `${clean || fallback}${ext ? `.${ext}` : ''}`
}

/**
 * Upload bytes to WhatsApp, send them to `recipient`, persist the outbound message (human
 * attribution, delivery, private copy for the thread). Caller authenticates and rate-limits.
 */
export async function sendWhatsAppMediaBytes(opts: {
  tenantId: string
  userId: string
  socialAccountId: string
  recipient: string
  bytes: Uint8Array
  filename: string
  caption?: string
  clientRequestId?: string | null
  /** Extra metadata on the stored message (e.g. `{ guiaId }`, `{ reusedFromMessageId }`). */
  metadata?: Record<string, unknown>
}): Promise<SendMediaResult> {
  const db = prisma as any
  const { tenantId, userId, socialAccountId, recipient, bytes } = opts
  const caption = String(opts.caption || '').slice(0, 1024)
  const clientRequestId = opts.clientRequestId ?? null

  const media = classifyOutboundMedia({ filename: opts.filename, bytes })
  if (!media.ok) return { ok: false, error: media.error, status: 400 }

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
      return { ok: true, duplicate: true, message: mapMessageToDto(already), conversationId: already.conversationId ?? null }
    }
  }

  const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
  if (!found) return { ok: false, error: 'Línea no encontrada', status: 404 }
  if (found.platform !== 'whatsapp') {
    return { ok: false, error: 'Por ahora solo se pueden enviar archivos por WhatsApp.', status: 400 }
  }
  const tokenStatus = String(found.tokenStatus || '').toLowerCase()
  if (found.isActive === false || found.disconnectedAt || tokenStatus === 'revoked' || tokenStatus === 'expired') {
    return { ok: false, error: socialTokenSendBlockMessage(found), status: 400 }
  }
  const accessToken = decryptSocialAccessToken(found.accessToken)
  if (!accessToken) return { ok: false, error: 'Falta el token de WhatsApp. Reconectá la línea en Canales.', status: 400 }

  // 1) Upload the file to Meta → media id.
  const upload = new FormData()
  upload.append('messaging_product', 'whatsapp')
  upload.append('type', media.mime)
  upload.append('file', new Blob([bytes], { type: media.mime }), media.filename) // single copy of the bytes
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
    return { ok: false, error: upData?.error?.message || 'WhatsApp no aceptó el archivo.', status: 502 }
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
    return { ok: false, error: sendData?.error?.message || 'Falló el envío por WhatsApp', status: 502 }
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
        ...(opts.metadata ?? {}),
        ...(clientRequestId ? { clientRequestId } : {}),
      },
      snapshot,
    ),
    suppressSoftAi: true,
  })
  if (!isPersistedDualWrite(write)) {
    return { ok: false, error: 'El archivo se envió pero no se pudo guardar en Betsy.', status: 500, extra: { sent: true } }
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
  return { ok: true, message: saved ? mapMessageToDto(saved) : null, conversationId: write.conversationId ?? null }
}

/**
 * Bytes of a stored chat media message (tenant-scoped): private Blob copy first, then the
 * channel (Meta keeps media ~30 days). Used to re-send "recientes" without a new upload.
 */
export async function loadStoredChatMediaBytes(
  tenantId: string,
  messageId: string,
): Promise<{ ok: true; bytes: Buffer; mime: string | null; filename: string | null } | { ok: false; error: string; status: number }> {
  const db = prisma as any
  const message = await db.chatMessage.findFirst({
    where: { id: messageId, tenantId },
    select: {
      id: true,
      tenantId: true,
      socialAccountId: true,
      providerMediaId: true,
      mediaMimeType: true,
      mediaFilename: true,
      mediaBlobPath: true,
      mediaCacheStatus: true,
      metadata: true,
    },
  })
  if (!message) return { ok: false, error: 'Archivo no encontrado', status: 404 }
  const ref = readMediaBlobRefFromMessage(message)
  if (ref?.mediaCacheStatus === 'ready' && ref.mediaBlobPath) {
    try {
      const blob = await readChatMediaFromBlob({ pathname: ref.mediaBlobPath })
      return { ok: true, bytes: blob.bytes, mime: message.mediaMimeType || blob.contentType, filename: message.mediaFilename }
    } catch (error) {
      console.warn('[chat/send-media] recent blob read failed, trying channel', error instanceof Error ? error.message : error)
    }
  }
  if (!message.providerMediaId) return { ok: false, error: 'Este archivo ya no está disponible.', status: 404 }
  const account = await db.socialAccount.findFirst({
    where: { id: message.socialAccountId, tenantId },
    select: { accessToken: true, platform: true },
  })
  const accessToken = account ? decryptSocialAccessToken(account.accessToken) : null
  if (!accessToken) return { ok: false, error: 'La línea de este archivo necesita reconectarse.', status: 400 }
  const cached = await cacheProviderMediaToBlob({
    tenantId,
    messageId: message.id,
    providerMediaId: message.providerMediaId,
    accessToken,
    purpose: account?.platform === 'instagram' ? 'instagram' : 'whatsapp',
    mimeHint: message.mediaMimeType,
    filenameHint: message.mediaFilename,
  })
  if (!cached.ok) return { ok: false, error: 'Este archivo ya no está disponible en el canal.', status: 404 }
  return { ok: true, bytes: cached.bytes, mime: cached.ref.mediaMimeType ?? message.mediaMimeType, filename: message.mediaFilename }
}
