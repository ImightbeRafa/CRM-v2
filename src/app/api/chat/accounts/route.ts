import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { toChatAccountDto } from '@/lib/social-account-identity'
import {
  IDENTITY_REFRESH_TIMEOUT_MS,
  refreshMissingAccountIdentities,
} from '@/lib/social-account-identity-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ACCOUNT_SELECT = {
  id: true,
  platform: true,
  accountId: true,
  linkedAt: true,
  isActive: true,
  refreshToken: true,
  accessToken: true,
  displayName: true,
  providerDisplayName: true,
  providerUsername: true,
  displayPhoneNumber: true,
  wabaId: true,
  pageId: true,
  tokenStatus: true,
  tokenLastCheckedAt: true,
  expiresAt: true,
  disconnectedAt: true,
} as const

function mapAccountRow(row: {
  id: string
  platform: string
  accountId: string
  linkedAt: Date
  isActive: boolean
  refreshToken: string | null
  displayName: string | null
  providerDisplayName: string | null
  providerUsername: string | null
  displayPhoneNumber: string | null
  wabaId: string | null
  pageId: string | null
  tokenStatus: string | null
}) {
  const meta = parseSocialRefreshToken(row.refreshToken)
  return toChatAccountDto({
    ...row,
    whatsappBusinessAccountId: row.wabaId || meta.whatsappBusinessAccountId,
    pageId: row.pageId || meta.pageId,
  })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_sales')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const db = prisma as any
    const url = new URL(request.url)
    const includeInactive = url.searchParams.get('includeInactive') === '1'

    let rows = await db.socialAccount.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      select: ACCOUNT_SELECT,
    })

    const refreshResult = await refreshMissingAccountIdentities(rows, {
      timeoutMs: IDENTITY_REFRESH_TIMEOUT_MS,
      signal: request.signal,
    })
    if (refreshResult.refreshed > 0) {
      rows = await db.socialAccount.findMany({
        where: includeInactive ? { tenantId } : { tenantId, isActive: true },
        select: ACCOUNT_SELECT,
      })
    }

    const accounts = rows.map(mapAccountRow)

    return NextResponse.json({ success: true, accounts })
  } catch (error) {
    console.error('[chat/accounts] GET failed', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
