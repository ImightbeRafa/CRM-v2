import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { pickOrderLines } from '@/lib/order-channel-line'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_IDS = 200
const ID_PATTERN = /^[a-z0-9]{10,40}$/i

/**
 * GET /api/orders/lines?ids=<Order.id,…>
 * Read-only: the SocialAccount (line) each order came from, derived through
 * ChatMessage.orderId. Tenant-scoped; orders with no linked chat are simply absent.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const raw = new URL(request.url).searchParams.get('ids') || ''
    const ids = Array.from(
      new Set(
        raw
          .split(',')
          .map((id) => id.trim())
          .filter((id) => ID_PATTERN.test(id)),
      ),
    ).slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ lines: {} })

    const db = prisma as any
    const messages = await db.chatMessage.findMany({
      where: { tenantId, orderId: { in: ids } },
      select: { orderId: true, socialAccountId: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
    })
    const accountIds = Array.from(new Set<string>(messages.map((m: { socialAccountId: string }) => m.socialAccountId)))
    if (accountIds.length === 0) return NextResponse.json({ lines: {} })

    const accounts = await db.socialAccount.findMany({
      where: { tenantId, id: { in: accountIds } },
      select: { id: true, platform: true, displayName: true, displayPhoneNumber: true, providerUsername: true },
    })

    return NextResponse.json({ lines: pickOrderLines(messages, accounts) })
  } catch (error) {
    console.error('[orders/lines GET]', error)
    return NextResponse.json({ error: 'No se pudieron cargar las líneas' }, { status: 500 })
  }
}
