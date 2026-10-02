import { NextRequest, NextResponse } from 'next/server'
import { runChatWorkspaceSweep } from '@/lib/chat-workspace-sweep'
import { runChatAutomationRules } from '@/lib/chat-automation-rules-server'
import { cronsDisabled } from '@/lib/cron-kill-switch'
import { timingSafeEqualString } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  return timingSafeEqualString(request.headers.get('authorization') || '', `Bearer ${secret}`)
}

/** Every minute (Worker CRON_PATHS): assignment rules, auto-close, reopen on inbound. */
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
      return { rules: 0, fired: 0, failed: 0, skipped: 'tables_missing' as const }
    })
    return NextResponse.json({ status: 'ok', ...summary, automationRules: rules, durationMs: Date.now() - startedAt })
  } catch (error) {
    console.error('[chat-workspace-cron] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Chat workspace sweep failed' }, { status: 500 })
  }
}
