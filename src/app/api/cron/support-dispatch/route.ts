/**
 * Support ticket outbox (SPEC §5): webhook to the support agent + notification emails, with retries.
 * Worker cron every 5 min. Auth: Bearer CRON_SECRET (constant-time). Respects DISABLE_CRONS.
 * Always 200 when off / 059 missing / not the production container: a non-200 fails the whole cron run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireCronBearer } from '@/lib/ops/cron-auth'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { dispatchPendingSupportEvents } from '@/lib/support/dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function run(request: NextRequest) {
  const denied = requireCronBearer(request)
  if (denied) return denied
  if (cronsDisabled(process.env)) return NextResponse.json({ status: 'skipped', reason: 'DISABLE_CRONS' })
  try {
    return NextResponse.json(await dispatchPendingSupportEvents({ limit: 25 }))
  } catch (error) {
    console.error('[support-dispatch] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ status: 'error' })
  }
}

export const GET = run
export const POST = run
