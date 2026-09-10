import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { chatMessagesWhereForPeer } from '@/lib/chat-message-query'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/chat/messages?socialAccountId=...&limit=50&cursor=&recipientId=
 * Fetch paginated messages for a given social account (tenant-scoped).
 * Optional recipientId scopes to one Soft Copilot thread for “cargar anteriores”.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const url = new URL(request.url)
    const socialAccountId = url.searchParams.get('socialAccountId')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)
    const cursor = url.searchParams.get('cursor') || undefined
    const recipientId = url.searchParams.get('recipientId') || undefined

    if (!socialAccountId) {
      return NextResponse.json({ error: 'Missing socialAccountId' }, { status: 400 })
    }

    const db = prisma as any

    // Verify the account belongs to the tenant
    const account = await db.socialAccount.findFirst({
      where: { id: socialAccountId, tenantId, isActive: true },
      select: { id: true, platform: true, accountId: true },
    })
    if (!account) {
      return NextResponse.json({ error: 'Social account not found' }, { status: 404 })
    }

    const where = chatMessagesWhereForPeer({ socialAccountId, recipientId })
    const messages = await db.chatMessage.findMany({
      where,
      orderBy: { sentAt: 'desc' },
      take: limit + 1, // fetch one extra to know if there’s a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        direction: true,
        content: true,
        metadata: true,
        sentAt: true,
        receivedAt: true,
        clientId: true,
        orderId: true,
      },
    })

    const hasMore = messages.length > limit
    const data = hasMore ? messages.slice(0, -1) : messages
    const nextCursor = hasMore ? messages[messages.length - 1].id : undefined

    return NextResponse.json({
      success: true,
      messages: data.reverse(), // oldest first for UI
      nextCursor,
      hasMore,
    })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
