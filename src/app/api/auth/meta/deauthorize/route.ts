import { NextRequest, NextResponse } from 'next/server'
import { processMetaDataRequest } from '@/lib/meta-data-deletion/core'
import { readMetaCallback } from '@/lib/meta-data-deletion/callback'
import { prismaDeletionStore, reportDeletionFailure } from '@/lib/meta-data-deletion/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Meta Deauthorize callback: the person removed Betsy in their Facebook / Instagram settings. Same as
 * Configuración › Cuentas conectadas → Desvincular for every line they connected (tokens cleared, line off,
 * history kept). Deleting the data is the separate data-deletion callback. Meta only needs a 200.
 */
export async function POST(request: NextRequest) {
  try {
    const callback = await readMetaCallback(request, 'meta/deauthorize')
    if (!callback.ok) return callback.response

    const outcome = await processMetaDataRequest({ metaUserId: callback.userId, kind: 'deauthorize' }, prismaDeletionStore, {
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
