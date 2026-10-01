import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getChatAdAttribution } from '@/lib/meta-attribution/read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** The ad that brought this chat (first and last click), for the chat side panel. Read-only. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const { id } = await context.params
    const conversation = await prisma.chatConversation.findFirst({
      where: { id, tenantId: auth.tenantId },
      select: { id: true },
    })
    if (!conversation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    }

    const attribution = await getChatAdAttribution(auth.tenantId, conversation.id)
    return NextResponse.json(
      { success: true, attribution },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    console.error('[chat/conversations/attribution] GET failed', error)
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500 })
  }
}
