import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import {
  buildMediaCacheMetadataPatch,
  cacheProviderMediaToBlob,
  readChatMediaFromBlob,
  readMediaBlobRefFromMessage,
} from '@/lib/chat-media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ messageId: string }> }

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
        return new NextResponse(new Uint8Array(blob.bytes), {
          status: 200,
          headers: {
            'Content-Type':
              blob.contentType ||
              existingRef.mediaMimeType ||
              'application/octet-stream',
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
          },
        })
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

    if (!providerMediaId) {
      return NextResponse.json(
        { error: 'No media available for this message' },
        { status: 404 },
      )
    }

    const account = await prisma.socialAccount.findFirst({
      where: { id: message.socialAccountId, tenantId: auth.tenantId },
      select: { accessToken: true, platform: true },
    })
    const accessToken = account ? decryptSocialAccessToken(account.accessToken) : null
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing channel token' }, { status: 400 })
    }

    const cached = await cacheProviderMediaToBlob({
      tenantId: message.tenantId,
      messageId: message.id,
      providerMediaId,
      accessToken,
      purpose: account?.platform === 'instagram' ? 'instagram' : 'whatsapp',
      mimeHint: message.mediaMimeType,
      filenameHint: message.mediaFilename,
    })

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

    return new NextResponse(new Uint8Array(cached.bytes), {
      status: 200,
      headers: {
        'Content-Type': cached.ref.mediaMimeType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[chat/media GET]', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
