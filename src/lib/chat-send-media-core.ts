import 'server-only'
import { isDemoPeerId } from '@/lib/demo-chat'
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
import {
  claimChatSend,
  findOutboundByClientRequestId,
  markChatSendDelivered,
  releaseChatSend,
  resolveDeliveredOutboundRow,
} from '@/lib/chat-send-claim'
import { mapMessageToDto } from '@/lib/chat-conversation-api'
import { buildHumanSenderSnapshot, mergeHumanSenderMetadata } from '@/lib/chat-human-attribution'
import { autoAssignOnFirstHumanReply } from '@/lib/chat-auto-assign'
import { recordHumanSendMetrics } from '@/lib/chat-send-metrics'
import {
  buildMediaCacheMetadataPatch,
  cacheProviderMediaToBlob,
  putChatMediaToBlob,
  readChatMediaFromBlob,
  readMediaBlobRefFromMessage,
} from '@/lib/chat-media'
import { buildWhatsAppMediaMessage, classifyOutboundMedia, outboundMediaContent } from '@/lib/chat-outbound-media'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import {
  INSTAGRAM_IMAGE_MAX_BYTES,
  INSTAGRAM_IMAGE_MIMES,
  INSTAGRAM_MEDIA_ONLY_PHOTOS,
  sendInstagramImage,
  sendInstagramText,
  uploadInstagramImage,
} from '@/lib/instagram-media'

const META_TIMEOUT_MS = 30_000

export type SendMediaResult =
  | {
      ok: true
      message: ReturnType<typeof mapMessageToDto> | null
      conversationId: string | null
      duplicate?: boolean
      /** false: the customer got it but Betsy could not store it (the bubble stays "sent", never an error). */
      persisted?: boolean
      /** Another request with this id is sending it right now. */
      inFlight?: boolean
    }
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
  /** Quick reply shortcut the agent inserted (activity metric only; sanitized server-side). */
  quickReplyShortcut?: unknown
}): Promise<SendMediaResult> {
  const db = prisma as any
  const { tenantId, userId, socialAccountId, recipient, bytes } = opts
  const caption = String(opts.caption || '').slice(0, 1024)
  const clientRequestId = opts.clientRequestId ?? null

  // Demo chats (Meta review kit) have made-up customer ids: never send those to Meta.
  if (isDemoPeerId(recipient)) {
    return { ok: false, error: 'Este es un chat de demostración: no se envía a Instagram ni a WhatsApp.', status: 400 }
  }

  const media = classifyOutboundMedia({ filename: opts.filename, bytes })
  if (!media.ok) return { ok: false, error: media.error, status: 400 }

  // Retry of a file that already went out (same pending file → same clientRequestId): no re-send.
  const already = await findOutboundByClientRequestId(db, { tenantId, socialAccountId, clientRequestId })
  if (already) {
    return { ok: true, duplicate: true, message: mapMessageToDto(already), conversationId: already.conversationId ?? null }
  }

  const found = await db.socialAccount.findFirst({ where: { id: socialAccountId, tenantId } })
  if (!found) return { ok: false, error: 'Línea no encontrada', status: 404 }
  const platform: 'whatsapp' | 'instagram' | null =
    found.platform === 'whatsapp' ? 'whatsapp' : found.platform === 'instagram' ? 'instagram' : null
  if (!platform) return { ok: false, error: 'Esta línea no permite enviar archivos.', status: 400 }
  // Instagram: photos only (JPG / PNG, 8 MB), refused before any token use or upload.
  if (platform === 'instagram' && (media.kind !== 'image' || !INSTAGRAM_IMAGE_MIMES.has(media.mime) || media.size > INSTAGRAM_IMAGE_MAX_BYTES)) {
    return { ok: false, error: INSTAGRAM_MEDIA_ONLY_PHOTOS, status: 400 }
  }
  const tokenStatus = String(found.tokenStatus || '').toLowerCase()
  if (found.isActive === false || found.disconnectedAt || tokenStatus === 'revoked' || tokenStatus === 'expired') {
    return { ok: false, error: socialTokenSendBlockMessage(found), status: 400 }
  }
  const accessToken = decryptSocialAccessToken(found.accessToken)
  if (!accessToken) {
    return { ok: false, error: `Falta el token de ${platform === 'instagram' ? 'Instagram' : 'WhatsApp'}. Reconectá la línea en Canales.`, status: 400 }
  }

  // The id is taken in the database before anything goes to Meta: a retry / second tab never sends twice.
  const claim = await claimChatSend(tenantId, clientRequestId)
  if (claim.kind === 'delivered') {
    const row = claim.messageId
      ? await db.chatMessage.findFirst({ where: { id: claim.messageId, tenantId, socialAccountId: found.id } })
      : null
    return { ok: true, duplicate: true, persisted: Boolean(row), message: row ? mapMessageToDto(row) : null, conversationId: row?.conversationId ?? null }
  }
  if (claim.kind === 'in_flight') {
    return { ok: true, duplicate: true, inFlight: true, persisted: false, message: null, conversationId: null }
  }
  const ownsClaim = claim.kind === 'claimed'

  let mediaId: string | null = null
  let providerMessageId: string | undefined
  let sendData: any
  // True once Meta accepted the file: from here on the answer is never an error.
  let delivered = false
  let ambiguous = false
  try {
    if (platform === 'instagram') {
      // 1–2) Upload the photo to the Page (Meta gets the bytes, never a link), then send it; the caption follows as text.
      const pageId = found.pageId || parseSocialRefreshToken(found.refreshToken).pageId
      const up = await uploadInstagramImage({ pageId, accessToken, bytes, mime: media.mime, timeoutMs: META_TIMEOUT_MS })
      if (!up.ok) {
        console.error('[chat/send-media] instagram upload failed', { error: up.error })
        return { ok: false, error: up.error, status: 502 }
      }
      const sentImg = await sendInstagramImage({ pageId, accessToken, recipient, attachmentId: up.attachmentId, timeoutMs: META_TIMEOUT_MS })
      if (!sentImg.ok) {
        console.error('[chat/send-media] instagram send failed', { error: sentImg.error })
        return { ok: false, error: sentImg.error, status: 502 }
      }
      delivered = true
      providerMessageId = sentImg.providerMessageId || undefined
      sendData = sentImg.data
      // The caption goes out as its own text AFTER the photo row is saved (below), never stored unsent.
    } else {
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
      mediaId = typeof upData?.id === 'string' ? upData.id : null
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
      }).catch((error: unknown) => {
        // Timed out after the send left: Meta may have it. Keep the claim (stale in 2 min).
        const name = (error as { name?: string } | null)?.name
        if (name === 'AbortError' || name === 'TimeoutError') ambiguous = true
        throw error
      })
      sendData = await readJson(sendRes)
      if (!sendRes.ok) {
        console.error('[chat/send-media] send failed', { status: sendRes.status, error: sendData?.error?.message })
        return { ok: false, error: sendData?.error?.message || 'Falló el envío por WhatsApp', status: 502 }
      }
      delivered = true
      providerMessageId = sendData?.messages?.[0]?.id
    }
  } finally {
    // Meta refused it (or it never left): Retry may send this id again. A timeout is ambiguous.
    if (ownsClaim && !delivered && !ambiguous) await releaseChatSend(tenantId, clientRequestId)
  }

  // 3) Persist like a human text send (attribution, conversation, delivery). The customer already has
  // it: a storage failure answers success with persisted:false, never "falló".
  try {
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
    const sendMetadata = mergeHumanSenderMetadata(
      {
        to: recipient,
        provider: platform,
        platform,
        messageType: media.kind,
        ...(opts.metadata ?? {}),
        ...(clientRequestId ? { clientRequestId } : {}),
      },
      snapshot,
    )
    const write = await dualWriteChatMessage({
      tenantId,
      socialAccountId: found.id,
      direction: 'outbound',
      // Instagram: the photo row is just the photo; its caption is a separate text row (only once it is sent).
      content: outboundMediaContent(media.kind, platform === 'instagram' ? '' : caption),
      sentAt: new Date(),
      receivedAt: null,
      peerId: recipient,
      providerMessageId: providerMessageId || null,
      messageType: media.kind,
      deliveryStatus: 'pending',
      platform,
      senderUserId: userId,
      // Instagram has no downloadable media id: the thread shows our private copy (step 4).
      providerMediaId: platform === 'whatsapp' ? mediaId : null,
      mediaMimeType: media.mime,
      mediaFilename: media.filename,
      metadata: sendMetadata,
      suppressSoftAi: true,
    })
    const stored = await resolveDeliveredOutboundRow(db, write, {
      tenantId,
      socialAccountId: found.id,
      providerMessageId,
      clientRequestId,
      metadata: sendMetadata,
    })
    if (ownsClaim) {
      await markChatSendDelivered(tenantId, clientRequestId, {
        providerMessageId: providerMessageId || null,
        messageId: stored?.messageId ?? null,
      })
    }
    if (!stored) {
      console.error('[chat/send-media] delivered but not stored', { reason: !write.ok ? write.reason : 'duplicate' })
      return { ok: true, persisted: false, message: null, conversationId: null }
    }

    // 4) Private copy for the thread (the uploaded media id also works for ~30 days).
    try {
      const blob = await putChatMediaToBlob({
        tenantId,
        messageId: stored.messageId,
        bytes: Buffer.from(bytes),
        contentType: media.mime,
      })
      const ref = {
        mediaBlobPath: blob.pathname,
        mediaCacheStatus: 'ready' as const,
        mediaMimeType: media.mime,
        mediaFilename: media.filename,
      }
      const row = await db.chatMessage.findFirst({ where: { id: stored.messageId, tenantId }, select: { metadata: true } })
      const meta = row?.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {}
      await db.chatMessage.updateMany({
        where: { id: stored.messageId, tenantId },
        data: {
          mediaBlobPath: blob.pathname,
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
      messageId: stored.messageId,
      tenantId,
      conversationId: stored.conversationId,
      userId,
      providerMessageId: providerMessageId || null,
      deliveryStatus: providerMessageId ? 'sent' : 'failed',
      errorCode: providerMessageId ? null : 'missing_provider_message_id',
      providerResponse: sendData,
    })

    if (providerMessageId && senderUser) {
      await autoAssignOnFirstHumanReply(db, { tenantId, conversationId: stored.conversationId, userId })
      // Fire-and-forget activity metrics (never awaited: must not delay the send).
      void recordHumanSendMetrics({
        tenantId,
        conversationId: stored.conversationId,
        userId,
        messageId: stored.messageId,
        quickReplyShortcut: opts.quickReplyShortcut,
        media: true,
      })
    }

    // Instagram caption: sent after the photo is saved, stored as its own text row only when Meta accepted it.
    if (platform === 'instagram' && providerMessageId && caption.trim()) {
      const pageId = found.pageId || parseSocialRefreshToken(found.refreshToken).pageId
      const text = caption.trim()
      const sentText = await sendInstagramText({ pageId, accessToken, recipient, text, timeoutMs: META_TIMEOUT_MS }).catch(() => null)
      if (sentText?.ok) {
        const captionWrite = await dualWriteChatMessage({
          tenantId,
          socialAccountId: found.id,
          direction: 'outbound',
          content: text,
          sentAt: new Date(),
          receivedAt: null,
          peerId: recipient,
          providerMessageId: sentText.providerMessageId,
          messageType: 'text',
          deliveryStatus: sentText.providerMessageId ? 'sent' : 'pending',
          platform,
          senderUserId: userId,
          metadata: mergeHumanSenderMetadata({ to: recipient, provider: platform, platform, captionOfMessageId: stored.messageId }, snapshot),
          suppressSoftAi: true,
        })
        if (!isPersistedDualWrite(captionWrite)) console.warn('[chat/send-media] instagram caption sent but not stored')
      } else {
        console.warn('[chat/send-media] instagram caption not sent')
      }
    }

    const saved = await db.chatMessage.findFirst({ where: { id: stored.messageId, tenantId } })
    return { ok: true, message: saved ? mapMessageToDto(saved) : null, conversationId: stored.conversationId }
  } catch (error) {
    console.error('[chat/send-media] delivered but not stored', error instanceof Error ? error.name : 'unknown')
    if (ownsClaim) await markChatSendDelivered(tenantId, clientRequestId, { providerMessageId: providerMessageId || null })
    return { ok: true, persisted: false, message: null, conversationId: null }
  }
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
    // Only files this business sent (photos / videos / documents), never a customer's upload.
    where: { id: messageId, tenantId, direction: 'outbound', messageType: { in: ['image', 'video', 'document'] } },
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
  const meta = message.metadata && typeof message.metadata === 'object' ? (message.metadata as Record<string, unknown>) : {}
  // A guía PDF holds one customer's address: it is only ever sent by /api/chat/send-guia.
  if (meta.guiaId) return { ok: false, error: 'Las guías se envían desde el pedido.', status: 400 }
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
