import { NextRequest, NextResponse } from 'next/server'
import { getMetaWebhookAppSecrets } from '@/lib/meta-api'
import { parseMetaSignedRequest, readSignedRequestFromBody } from '@/lib/meta-signed-request'
import { isMetaUserId, processMetaDataRequest } from '@/lib/meta-data-deletion/core'
import { prismaDeletionStore, removeChatPaths, reportDeletionFailure } from '@/lib/meta-data-deletion/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Meta Deauthorize callback: the person removed Betsy in their Facebook / Instagram settings. Same as
 * Settings → Disconnect for every line they connected (tokens cleared, line off, history kept). Deleting the
 * data is the separate data-deletion callback. Meta only needs a 200.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = (await request.text()).slice(0, 16_384)
    const signedRequest = readSignedRequestFromBody(rawBody, request.headers.get('content-type'))
    if (!signedRequest) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const secrets = getMetaWebhookAppSecrets().map((s) => s.secret)
    if (secrets.length === 0) {
      console.error('[meta/deauthorize] No Meta app secret configured')
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }

    const payload = parseMetaSignedRequest(signedRequest, secrets)
    if (!payload) {
      console.error('[meta/deauthorize] Signature verification failed')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    const userId = String(payload.user_id || '').trim()
    if (!isMetaUserId(userId)) return NextResponse.json({ error: 'Invalid user' }, { status: 400 })

    const outcome = await processMetaDataRequest({ metaUserId: userId, kind: 'deauthorize' }, prismaDeletionStore, removeChatPaths, {
      onFailure: reportDeletionFailure,
    })
    console.log('[meta/deauthorize] Request processed', {
      status: outcome.status,
      matchedAccounts: outcome.matchedAccounts,
      recorded: outcome.recorded,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[meta/deauthorize] Error', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
