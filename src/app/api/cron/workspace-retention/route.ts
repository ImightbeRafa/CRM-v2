/**
 * Nightly retention for workspace logs (ActivityEvent 13 months, notifications 90 / 180 days), and the retry of
 * Meta data-deletion requests whose erase or file deletion did not finish (privacy §8.2).
 * Auth: Bearer CRON_SECRET (constant-time). Respects DISABLE_CRONS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqualString } from '@/lib/security'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { purgeWorkspaceLogs } from '@/lib/workspace-retention'
import { retryOpenDeletionRequests } from '@/lib/meta-data-deletion/core'
import { prismaDeletionStore, removeChatPaths, reportDeletionFailure } from '@/lib/meta-data-deletion/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  if (!timingSafeEqualString(request.headers.get('authorization') || '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (cronsDisabled(process.env)) return NextResponse.json({ status: 'skipped', reason: 'DISABLE_CRONS' })
  try {
    const result = await purgeWorkspaceLogs({ budgetMs: 30_000 })
    let metaDeletion: Awaited<ReturnType<typeof retryOpenDeletionRequests>> | { error: string }
    try {
      metaDeletion = await retryOpenDeletionRequests(prismaDeletionStore, removeChatPaths, {
        budgetMs: 15_000,
        onFailure: reportDeletionFailure,
      })
    } catch (error) {
      reportDeletionFailure('retry', error instanceof Error ? error.name : 'unknown')
      metaDeletion = { error: 'retry_failed' }
    }
    return NextResponse.json({ status: 'ok', ...result, metaDeletion })
  } catch (error) {
    console.error('[workspace-retention] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Retention failed' }, { status: 500 })
  }
}
