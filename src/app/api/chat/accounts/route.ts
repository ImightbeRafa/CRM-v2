import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const db = prisma as any
    const url = new URL(request.url)
    const includeInactive = url.searchParams.get('includeInactive') === '1'

    const rows = await db.socialAccount.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      select: {
        id: true,
        platform: true,
        accountId: true,
        linkedAt: true,
        isActive: true,
        refreshToken: true,
      },
    })

    const accounts = rows.map((row: {
      id: string
      platform: string
      accountId: string
      linkedAt: Date
      isActive: boolean
      refreshToken: string | null
    }) => {
      const meta = parseSocialRefreshToken(row.refreshToken)
      return {
        id: row.id,
        platform: row.platform,
        accountId: row.accountId,
        linkedAt: row.linkedAt,
        isActive: row.isActive,
        phoneNumberId: row.platform === 'whatsapp' ? row.accountId : null,
        whatsappBusinessAccountId: row.platform === 'whatsapp' ? meta.whatsappBusinessAccountId : null,
        pageId: row.platform === 'instagram' ? meta.pageId : null,
      }
    })

    return NextResponse.json({ success: true, accounts })
  } catch (error) {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
