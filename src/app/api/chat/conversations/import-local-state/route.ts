import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  importLocalStateBodySchema,
  parseConversationKey,
} from '@/lib/chat-conversation-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response

    const json = await request.json().catch(() => null)
    const parsed = importLocalStateBodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    let updated = 0
    let skipped = 0

    for (const item of parsed.data.items) {
      const keyParts = parseConversationKey(item.conversationKey)
      if (!keyParts) {
        skipped += 1
        continue
      }

      const existing = await prisma.chatConversation.findFirst({
        where: {
          tenantId: auth.tenantId,
          socialAccountId: keyParts.socialAccountId,
          peerId: keyParts.peerId,
        },
        select: { id: true, status: true, tags: true },
      })
      if (!existing) {
        skipped += 1
        continue
      }

      const data: { status?: string; tags?: string[] } = {}
      const statusStillDefault = existing.status === 'nuevo'
      const tagsStillDefault = !existing.tags.length

      if (item.status && statusStillDefault) data.status = item.status
      if (item.tags?.length && tagsStillDefault) data.tags = item.tags

      if (!Object.keys(data).length) {
        skipped += 1
        continue
      }

      await prisma.chatConversation.update({
        where: { id: existing.id },
        data,
      })
      updated += 1
    }

    return NextResponse.json({ success: true, updated, skipped })
  } catch (error) {
    console.error('[chat/conversations/import-local-state POST]', error)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 })
  }
}
