import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { softUnlinkUpdateData } from '@/lib/social-account-token-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/social/unlink?id=...
 * Soft-unlink: deactivate + clear tokens. Never deletes SocialAccount or chat history.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { tenantId } = auth
    const accountId = new URL(request.url).searchParams.get('id')

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
    }

    const db = prisma as any
    const rows = await db.$queryRaw`
      SELECT id, "tenantId", platform, "accountId", "pageId", "wabaId", "refreshToken"
      FROM "SocialAccount"
      WHERE id = ${accountId}
    `

    if (!rows || (rows as any[]).length === 0) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const account = (rows as any[])[0]
    if (account.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Account does not belong to your tenant' }, { status: 403 })
    }

    // Preserve pageId/wabaId from legacy refreshToken encoding before clearing credentials.
    const meta = parseSocialRefreshToken(account.refreshToken)
    const pageId = account.pageId || meta.pageId || null
    const wabaId = account.wabaId || meta.whatsappBusinessAccountId || null

    await db.socialAccount.update({
      where: { id: accountId },
      data: {
        ...softUnlinkUpdateData(),
        pageId,
        wabaId,
      },
    })

    return NextResponse.json({
      success: true,
      softUnlinked: true,
      message: 'Account unlinked successfully. Conversation history was kept.',
    })
  } catch (e: any) {
    console.error('[social/unlink] Error', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
