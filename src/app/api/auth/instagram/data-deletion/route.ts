import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { purgeChatOnlyWorkspaceData } from '@/lib/workspace-purge'
import { getMetaWebhookAppSecrets } from '@/lib/meta-api'
import { parseMetaSignedRequest, readSignedRequestFromBody } from '@/lib/meta-signed-request'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET handler for Meta verification
 * Meta checks if the endpoint exists before approving the app
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Data deletion endpoint is active',
    method: 'POST',
    description: 'Send a POST request with signed_request parameter to delete user data',
  })
}

/**
 * Meta Data Deletion Request callback (required for App Review).
 * Meta POSTs `signed_request` form-encoded when a user removes the app. We verify it
 * against our Meta app secrets (Inbox app first), delete what matches the user, and
 * answer `{ url, confirmation_code }` — the url is a public status page.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = (await request.text()).slice(0, 16_384)
    const signedRequest = readSignedRequestFromBody(rawBody, request.headers.get('content-type'))
    if (!signedRequest) {
      console.error('[instagram/data-deletion] No signed_request provided')
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const secrets = getMetaWebhookAppSecrets().map((s) => s.secret)
    if (secrets.length === 0) {
      console.error('[instagram/data-deletion] No Meta app secret configured')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const payload = parseMetaSignedRequest(signedRequest, secrets)
    if (!payload) {
      console.error('[instagram/data-deletion] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const userId = String(payload.user_id || '').trim()
    if (!/^\d{1,30}$/.test(userId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
    }

    const confirmationCode = `BETSY-DEL-${crypto.randomBytes(6).toString('hex').toUpperCase()}`

    // Instagram rows keyed by this Meta user id (Instagram Login–scoped accounts).
    const doomedChats = await prisma.chatConversation.findMany({
      where: { socialAccount: { platform: 'instagram', accountId: userId } },
      select: { id: true },
    })
    // Never let the cleanup block Meta's deletion itself (it must always complete).
    await purgeChatOnlyWorkspaceData(doomedChats.map((c) => c.id)).catch((error) => {
      console.error('[instagram/data-deletion] workspace purge failed', error instanceof Error ? error.name : 'unknown')
    })
    const deletedAccounts = await prisma.socialAccount.deleteMany({
      where: { platform: 'instagram', accountId: userId },
    })

    // No tokens, names or message content in logs — code + count only for follow-up.
    console.log('[instagram/data-deletion] Request processed', {
      confirmationCode,
      deletedAccounts: deletedAccounts.count,
    })

    const origin = (process.env.NEXTAUTH_URL || 'https://www.betsycrm.com').replace(/\/$/, '')
    return NextResponse.json({
      url: `${origin}/data-deletion?code=${encodeURIComponent(confirmationCode)}`,
      confirmation_code: confirmationCode,
    })
  } catch (error) {
    console.error('[instagram/data-deletion] Error', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
