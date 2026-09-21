import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import {
  defaultDisplayNameAtConnect,
  toChatAccountDto,
  validateDisplayNameInput,
} from '@/lib/social-account-identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * PATCH /api/chat/accounts/:id
 * Body: { displayName: string }
 * - update_config
 * - empty/whitespace → reset to provider default (§7.2)
 * - cross-tenant → 404
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { tenantId } = auth

    const { id } = await context.params
    if (!id?.trim()) {
      return NextResponse.json({ error: 'Missing account id' }, { status: 400 })
    }

    const db = prisma as any
    const existing = await db.socialAccount.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        platform: true,
        accountId: true,
        linkedAt: true,
        isActive: true,
        refreshToken: true,
        displayName: true,
        providerDisplayName: true,
        providerUsername: true,
        displayPhoneNumber: true,
        wabaId: true,
        pageId: true,
        tokenStatus: true,
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('displayName' in body)) {
      return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
    }

    const validated = validateDisplayNameInput(body.displayName)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    let nextDisplayName = validated.value
    if (validated.reset) {
      nextDisplayName = defaultDisplayNameAtConnect({
        platform: existing.platform,
        providerDisplayName: existing.providerDisplayName,
        displayPhoneNumber: existing.displayPhoneNumber,
        providerUsername: existing.providerUsername,
      })
    }

    const updated = await db.socialAccount.update({
      where: { id: existing.id },
      data: { displayName: nextDisplayName },
      select: {
        id: true,
        platform: true,
        accountId: true,
        linkedAt: true,
        isActive: true,
        refreshToken: true,
        displayName: true,
        providerDisplayName: true,
        providerUsername: true,
        displayPhoneNumber: true,
        wabaId: true,
        pageId: true,
        tokenStatus: true,
      },
    })

    const meta = parseSocialRefreshToken(updated.refreshToken)
    const account = toChatAccountDto({
      ...updated,
      whatsappBusinessAccountId: updated.wabaId || meta.whatsappBusinessAccountId,
      pageId: updated.pageId || meta.pageId,
    })

    return NextResponse.json({ success: true, account })
  } catch (error) {
    console.error('[chat/accounts/:id] PATCH failed', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
