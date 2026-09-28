import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'

export const dynamic = 'force-dynamic'

const MAX_ITEMS = 30

/**
 * GET /api/chat/recent-media — the business's latest photos / documents sent from chats
 * ("Recientes" in the composer). Metadata only; bytes are served by `/api/chat/media/[id]`.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const kind = new URL(request.url).searchParams.get('kind') === 'document' ? 'document' : 'image'

  const rows = await (prisma as any).chatMessage.findMany({
    where: {
      tenantId: auth.tenantId,
      direction: 'outbound',
      messageType: kind,
      OR: [{ providerMediaId: { not: null } }, { mediaBlobPath: { not: null } }],
      sentAt: { gte: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { sentAt: 'desc' },
    take: MAX_ITEMS * 3,
    select: { id: true, mediaMimeType: true, mediaFilename: true, mediaSizeBytes: true, sentAt: true, metadata: true },
  })

  // The same file sent to many chats shows once (name + size).
  const seen = new Set<string>()
  const items: Array<{ messageId: string; mimeType: string | null; filename: string | null; sentAt: string }> = []
  for (const row of rows) {
    // Guía PDFs belong to one customer: never offered for re-use.
    if ((row.metadata as Record<string, unknown> | null)?.guiaId) continue
    const key = `${row.mediaFilename || ''}:${row.mediaSizeBytes ?? row.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      messageId: row.id,
      mimeType: row.mediaMimeType ?? null,
      filename: row.mediaFilename ?? null,
      sentAt: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
    })
    if (items.length >= MAX_ITEMS) break
  }
  return NextResponse.json({ success: true, items }, { headers: { 'Cache-Control': 'no-store' } })
}
