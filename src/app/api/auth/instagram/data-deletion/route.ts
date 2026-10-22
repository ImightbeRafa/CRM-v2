import { NextRequest, NextResponse } from 'next/server'
import { processMetaDataRequest } from '@/lib/meta-data-deletion/core'
import { readMetaCallback } from '@/lib/meta-data-deletion/callback'
import { prismaDeletionStore, reportDeletionFailure } from '@/lib/meta-data-deletion/store'

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
 * Instagram and WhatsApp lines the person connected). The signed_request is verified and checked in
 * readMetaCallback. The lines are disconnected now, the owner is told, and the chats are erased 72 hours later
 * (meta-data-deletion/core). We answer `{ url, confirmation_code }`; the url is the public status page.
 */
export async function POST(request: NextRequest) {
  try {
    const callback = await readMetaCallback(request, 'instagram/data-deletion')
    if (!callback.ok) return callback.response

    const outcome = await processMetaDataRequest({ metaUserId: callback.userId, kind: 'deletion' }, prismaDeletionStore, {
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
