import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import {
  buildMediaCacheMetadataPatch,
  cacheInstagramAttachmentToBlob,
  cacheProviderMediaToBlob,
  instagramAttachmentUrl,
  parseSingleByteRange,
  safeMediaServeHeaders,
  readChatMediaFromBlob,
  readMediaBlobRefFromMessage,
} from '@/lib/chat-media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ messageId: string }> }

/** 200 full body, or 206 for a single `Range` (iOS Safari needs this for audio/video). */
function mediaResponse(
  request: NextRequest,
  bytes: Buffer,
  contentType: string,
  filename?: string | null,
): NextResponse {
  const base = {
    ...safeMediaServeHeaders(contentType, filename),
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  }
  const range = parseSingleByteRange(request.headers.get('range'), bytes.length)
  if (range === 'unsatisfiable') {
    return new NextResponse(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${bytes.length}` } })
  }
  if (range) {
    const slice = bytes.subarray(range.start, range.end + 1)
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...base,
        'Content-Range': `bytes ${range.start}-${range.end}/${bytes.length}`,
        'Content-Length': String(slice.length),
      },
    })
  }
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: { ...base, 'Content-Length': String(bytes.length) },
  })
}

/**
 * GET /api/chat/media/[messageId]
 * Auth: update_sales. Streams private Blob bytes (or caches from Meta then streams).
 * Never returns a Meta CDN URL to the client.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { messageId } = await context.params
    if (!messageId?.trim()) {
      return NextResponse.json({ error: 'Missing messageId' }, { status: 400 })
    }

    const message = await prisma.chatMessage.findFirst({
      where: { id: messageId, tenantId: auth.tenantId },
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
        content: true,
        messageType: true,
      },
    })
    if (!message) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const existingRef = readMediaBlobRefFromMessage(message)
    if (existingRef?.mediaCacheStatus === 'ready' && existingRef.mediaBlobPath) {
      try {
        const blob = await readChatMediaFromBlob({ pathname: existingRef.mediaBlobPath })
        return mediaResponse(
          request,
          blob.bytes,
          blob.contentType || existingRef.mediaMimeType || 'application/octet-stream',
          existingRef.mediaFilename,
        )
      } catch (error) {
        console.warn('[chat/media] Blob read failed, will try Meta re-cache', error)
      }
    }

    const providerMediaId =
      message.providerMediaId ||
      (message.metadata &&
      typeof message.metadata === 'object' &&
      !Array.isArray(message.metadata) &&
      typeof (message.metadata as Record<string, unknown>).providerMediaId === 'string'
        ? String((message.metadata as Record<string, unknown>).providerMediaId)
        : null)

    // Instagram attachments have no media id: a pre-signed CDN URL in the stored payload.
    const igUrl = providerMediaId ? null : instagramAttachmentUrl(message.metadata)
    if (!providerMediaId && !igUrl) {
      return NextResponse.json(
        { error: 'No media available for this message' },
        { status: 404 },
      )
    }

    let cached: Awaited<ReturnType<typeof cacheProviderMediaToBlob>>
    if (providerMediaId) {
      const account = await prisma.socialAccount.findFirst({
        where: { id: message.socialAccountId, tenantId: auth.tenantId },
        select: { accessToken: true, platform: true },
      })
      const accessToken = account ? decryptSocialAccessToken(account.accessToken) : null
      if (!accessToken) {
        return NextResponse.json({ error: 'Missing channel token' }, { status: 400 })
      }
      cached = await cacheProviderMediaToBlob({
        tenantId: message.tenantId,
        messageId: message.id,
        providerMediaId,
        accessToken,
        purpose: account?.platform === 'instagram' ? 'instagram' : 'whatsapp',
        mimeHint: message.mediaMimeType,
        filenameHint: message.mediaFilename,
      })
    } else {
      cached = await cacheInstagramAttachmentToBlob({
        tenantId: message.tenantId,
        messageId: message.id,
        url: igUrl!,
        mimeHint: message.mediaMimeType,
      })
    }

    if (!cached.ok) {
      const status = cached.status === 'too_large' ? 413 : 502
      const meta =
        message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
          ? (message.metadata as Record<string, unknown>)
          : {}
      try {
        await prisma.chatMessage.update({
          where: { id: message.id },
          data: {
            mediaCacheStatus: cached.status,
            mediaErrorCode: cached.status,
            metadata: {
              ...meta,
              mediaCacheStatus: cached.status,
            },
          },
        })
      } catch {
        // non-blocking — columns may be absent until 026 apply
      }
      return NextResponse.json({ error: cached.error }, { status })
    }

    const meta =
      message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
        ? (message.metadata as Record<string, unknown>)
        : {}
    try {
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: {
          mediaMimeType: cached.ref.mediaMimeType || message.mediaMimeType,
          mediaFilename: cached.ref.mediaFilename || message.mediaFilename,
          mediaBlobPath: cached.ref.mediaBlobPath,
          mediaCacheStatus: cached.ref.mediaCacheStatus,
          mediaSizeBytes: cached.bytes.length,
          mediaCachedAt: new Date(),
          mediaErrorCode: null,
          metadata: buildMediaCacheMetadataPatch(meta, cached.ref) as Prisma.InputJsonValue,
        },
      })
    } catch (error) {
      // Fallback: metadata-only if columns not applied yet on shared DB
      try {
        await prisma.chatMessage.update({
          where: { id: message.id },
          data: {
            metadata: buildMediaCacheMetadataPatch(meta, cached.ref) as Prisma.InputJsonValue,
          },
        })
      } catch (metaErr) {
        console.warn('[chat/media] Failed to persist mediaBlobPath', metaErr)
      }
    }

    return mediaResponse(
      request,
      cached.bytes,
      cached.ref.mediaMimeType || 'application/octet-stream',
      message.mediaFilename,
    )
  } catch (error) {
    console.error('[chat/media GET]', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
