import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getToken } from 'next-auth/jwt'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const db = prisma as any
    const token = await getToken({ req: request as any, secret: process.env.NEXTAUTH_SECRET })
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = (token as any).tenantId as string
    if (!tenantId) return NextResponse.json({ error: 'Tenant not found' }, { status: 400 })

    const rows = await db.socialAccount.findMany({
      where: { tenantId, isActive: true },
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
