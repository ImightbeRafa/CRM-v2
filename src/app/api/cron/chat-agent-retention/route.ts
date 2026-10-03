/**
 * Daily Soft Agent Layer retention — AI reply text, traces, suggestions, action args and feedback notes older than 90 days.
 * Auth: Bearer CRON_SECRET (same as other chat crons).
 */

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqualString } from '@/lib/security'
import { purgeChatAgentOutputs } from '@/lib/soft-ai/agent-retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || '').trim()
  const auth = request.headers.get('authorization') || ''
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!timingSafeEqualString(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Batches of 1,000 until nothing is left or ~40 s have passed, so the 90-day promise holds at any volume
  // (the next daily run continues where this one stopped).
  const started = Date.now()
  const total = { purged: 0, suggestionsPurged: 0, actionsPurged: 0, feedbackNotesPurged: 0, batches: 0 }
  let skipped = false
  for (;;) {
    const r = await purgeChatAgentOutputs({ batchSize: 1_000 })
    total.batches += 1
    skipped = r.skipped
    total.purged += r.purged
    total.suggestionsPurged += r.suggestionsPurged ?? 0
    total.actionsPurged += r.actionsPurged ?? 0
    total.feedbackNotesPurged += r.feedbackNotesPurged ?? 0
    const more =
      r.purged >= 1_000 || (r.suggestionsPurged ?? 0) >= 1_000 || (r.actionsPurged ?? 0) >= 1_000 ||
      (r.feedbackNotesPurged ?? 0) >= 1_000
    if (r.skipped || !more || Date.now() - started > 40_000) break
  }
  return NextResponse.json({ success: true, skipped, ...total })
}
