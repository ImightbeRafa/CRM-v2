import { NextRequest, NextResponse } from 'next/server'
import {
  claimBatch,
  purgeExpiredAutomationMetadata,
} from '@/lib/soft-ai/automation-queue'
import { processClaimedJob } from '@/lib/soft-ai/automation-processor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function isAuthorized(request: NextRequest) {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  try {
    const rows = await claimBatch(2)
    const results = []
    for (const row of rows) {
      if (Date.now() - startedAt > 50_000) break
      results.push(await processClaimedJob(row))
    }
    const purged = await purgeExpiredAutomationMetadata()
    const counts = results.reduce<Record<string, number>>((summary, result) => {
      summary[result.status] = (summary[result.status] || 0) + 1
      return summary
    }, {})
    return NextResponse.json({
      status: 'ok',
      claimed: rows.length,
      processed: results.length,
      counts,
      purged: purged.count,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error(
      '[chat-automation-cron] claimant failed',
      error instanceof Error ? error.name : 'unknown',
    )
    return NextResponse.json({ error: 'Chat automation claimant failed' }, { status: 500 })
  }
}
