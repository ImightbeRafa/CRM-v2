import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getMetaChatReadiness } from '@/lib/meta-chat-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/chat/meta-status
 * Owner/config diagnostic for Meta inbox setup. Never returns secret values.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config')
  if (!auth.ok) return auth.response

  const readiness = getMetaChatReadiness()
  const db = prisma as any

  const accounts = await db.socialAccount.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    select: { platform: true },
  }).catch(() => [] as Array<{ platform: string }>)

  const counts = new Map<string, number>()
  for (const row of accounts) {
    counts.set(row.platform, (counts.get(row.platform) || 0) + 1)
  }
  const linkedAccounts = Array.from(counts.entries()).map(([platform, count]) => ({ platform, count }))

  return NextResponse.json({
    success: true,
    ...readiness,
    tenant: {
      linkedAccounts,
      readyToReceive: linkedAccounts.some((row: { count: number }) => row.count > 0),
    },
  })
}
