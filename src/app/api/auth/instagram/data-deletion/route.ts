import { NextRequest, NextResponse } from 'next/server'
import { getMetaWebhookAppSecrets } from '@/lib/meta-api'
import { parseMetaSignedRequest, readSignedRequestFromBody } from '@/lib/meta-signed-request'
import { isMetaUserId, processMetaDataRequest } from '@/lib/meta-data-deletion/core'
import { prismaDeletionStore, removeChatPaths, reportDeletionFailure } from '@/lib/meta-data-deletion/store'

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
 * Meta Data Deletion Request callback (required for App Review; one URL for the whole app, so it covers the
 * Instagram and WhatsApp lines the person connected). Meta POSTs `signed_request` form-encoded. We verify it
 * against our Meta app secrets, delete what came through that person's lines (see meta-data-deletion/core) and
 * answer `{ url, confirmation_code }` — the url is the public status page that shows the real state.
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
    if (!isMetaUserId(userId)) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 400 })
    }

    const outcome = await processMetaDataRequest({ metaUserId: userId, kind: 'deletion' }, prismaDeletionStore, removeChatPaths, {
      onFailure: reportDeletionFailure,
    })

    // No ids, tokens, names or message content in logs — code, status and count only for follow-up.
    console.log('[instagram/data-deletion] Request processed', {
      confirmationCode: outcome.confirmationCode,
      status: outcome.status,
      matchedAccounts: outcome.matchedAccounts,
      recorded: outcome.recorded,
      reused: outcome.reused,
    })

    const origin = (process.env.NEXTAUTH_URL || 'https://www.betsycrm.com').replace(/\/$/, '')
    return NextResponse.json({
      url: `${origin}/data-deletion?code=${encodeURIComponent(outcome.confirmationCode)}`,
      confirmation_code: outcome.confirmationCode,
    })
  } catch (error) {
    console.error('[instagram/data-deletion] Error', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
