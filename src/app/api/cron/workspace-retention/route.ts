/**
 * Nightly retention for workspace logs (ActivityEvent 13 months, notifications 90 / 180 days),
 * plus the retry of chat files left over by a customer erasure (Ley 8968).
 * Auth: Bearer CRON_SECRET (constant-time). Respects DISABLE_CRONS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqualString } from '@/lib/security'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { purgeWorkspaceLogs } from '@/lib/workspace-retention'
import { retryPendingMediaPurges } from '@/lib/data-subject/erase'
import { erasureTablesReady } from '@/lib/data-subject/availability'

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
    const result = await purgeWorkspaceLogs({ budgetMs: 40_000 })
    // Ley 8968: chat files that could not be removed right after a customer erasure.
    const erasedFiles = (await erasureTablesReady()) ? await retryPendingMediaPurges(200).catch(() => null) : null
    return NextResponse.json({ status: 'ok', ...result, erasedFiles })
  } catch (error) {
    console.error('[workspace-retention] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Retention failed' }, { status: 500 })
  }
}
