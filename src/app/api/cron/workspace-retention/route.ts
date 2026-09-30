/**
 * Nightly retention for workspace logs (ActivityEvent 13 months, notifications 90 / 180 days) and
 * finished 2FA sign-in challenges (> 1 day).
 * Auth: Bearer CRON_SECRET (constant-time). Respects DISABLE_CRONS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqualString } from '@/lib/security'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { purgeWorkspaceLogs } from '@/lib/workspace-retention'
import { purgeOldMfaChallenges } from '@/lib/mfa-state'

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
    const result = await purgeWorkspaceLogs({ budgetMs: 45_000 })
    const mfaChallenges = await purgeOldMfaChallenges().catch(() => -1)
    return NextResponse.json({ status: 'ok', ...result, mfaChallenges })
  } catch (error) {
    console.error('[workspace-retention] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Retention failed' }, { status: 500 })
  }
}
