import { NextRequest, NextResponse } from 'next/server'
import { runChatWorkspaceSweep } from '@/lib/chat-workspace-sweep'
import { runChatAutomationRules } from '@/lib/chat-automation-rules-server'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { timingSafeEqualString } from '@/lib/security'
import { backfillInstagramPeerProfiles } from '@/lib/instagram-peer-profile'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  return timingSafeEqualString(request.headers.get('authorization') || '', `Bearer ${secret}`)
}

/** Every minute (Worker CRON_PATHS): assignment rules, auto-close, reopen on inbound, IG customer profiles. */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (cronsDisabled(process.env)) {
    return NextResponse.json({ status: 'skipped', reason: 'DISABLE_CRONS' })
  }
  const startedAt = Date.now()
  try {
    const summary = await runChatWorkspaceSweep({ budgetMs: 40_000 })
    // Automation rules (tag / assign / task). A failure here never fails the workspace sweep.
    const rules = await runChatAutomationRules({ budgetMs: 12_000 }).catch((error) => {
      console.error('[chat-automation-rules] sweep failed', error instanceof Error ? error.name : 'unknown')
      return { rules: 0, fired: 0, failed: 0, error: 'rules_failed' as const }
    })
    // Instagram customer names / photos for chats never looked up (5 per minute, stops on a Meta rate limit).
    const igProfiles = await backfillInstagramPeerProfiles({ limit: 5, budgetMs: 6_000 }).catch((error) => {
      console.error('[ig-peer-profile] backfill failed', error instanceof Error ? error.name : 'unknown')
      return { checked: 0, updated: 0, failed: 0, rateLimited: false, error: 'backfill_failed' as const }
    })
    return NextResponse.json({ status: 'ok', ...summary, automationRules: rules, igProfiles, durationMs: Date.now() - startedAt })
  } catch (error) {
    console.error('[chat-workspace-cron] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Chat workspace sweep failed' }, { status: 500 })
  }
}
