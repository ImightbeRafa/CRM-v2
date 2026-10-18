import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { readChatMediaFromBlob } from '@/lib/chat-media'
import { hasStoredPeerAvatar } from '@/lib/chat-peer-display'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/chat/conversations/[id]/avatar — the customer's photo (Instagram), from private chat storage.
 * Auth: update_sales, same tenant as the chat. Never a Meta link: the bytes were re-encoded to WebP when saved.
 * 404 when there is no photo (the inbox then shows initials).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { id } = await context.params
    const conversation = await prisma.chatConversation.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true, tenantId: true, peerAvatarUrl: true },
    })
    if (!conversation || !hasStoredPeerAvatar(conversation)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const blob = await readChatMediaFromBlob({ pathname: conversation.peerAvatarUrl as string })
    return new NextResponse(new Uint8Array(blob.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(blob.bytes.length),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
