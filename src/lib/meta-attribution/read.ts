import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'

/** What the team sees about the ad that brought a chat. Never includes the click id. */
export type ChatAdTouchDto = {
  platform: 'whatsapp' | 'instagram'
  sourceType: string | null
  sourceId: string | null
  sourceUrl: string | null
  headline: string | null
  body: string | null
  occurredAt: string
}

export type ChatAdAttributionDto = {
  firstTouch: ChatAdTouchDto
  lastTouch: ChatAdTouchDto
  touches: number
}

type Row = {
  platform: string
  sourceType: string | null
  sourceId: string | null
  sourceUrl: string | null
  headline: string | null
  body: string | null
  occurredAt: Date
}

function toDto(row: Row): ChatAdTouchDto {
  return {
    platform: row.platform === 'instagram' ? 'instagram' : 'whatsapp',
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    headline: row.headline,
    body: row.body,
    occurredAt: row.occurredAt.toISOString(),
  }
}

/** First + last ad touch for one chat (tenant-scoped). Null when none, or before SQL 039. */
export async function getChatAdAttribution(
  tenantId: string,
  conversationId: string,
): Promise<ChatAdAttributionDto | null> {
  try {
    const rows = await prisma.chatAdReferral.findMany({
      where: { tenantId, conversationId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        platform: true,
        sourceType: true,
        sourceId: true,
        sourceUrl: true,
        headline: true,
        body: true,
        occurredAt: true,
      },
    })
    if (rows.length === 0) return null
    return {
      firstTouch: toDto(rows[0]!),
      lastTouch: toDto(rows[rows.length - 1]!),
      touches: rows.length,
    }
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
}
