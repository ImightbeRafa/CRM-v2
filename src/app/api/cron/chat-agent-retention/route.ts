/**
 * Daily Soft Agent Layer retention — null outputText older than 90 days.
 * Auth: Bearer CRON_SECRET (same as other chat crons).
 */

import { NextRequest, NextResponse } from 'next/server'
import { purgeChatAgentOutputs } from '@/lib/soft-ai/agent-retention'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization') || ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // TODO(A1): optionally raise statement_timeout / lock_timeout for large tenants.
  const result = await purgeChatAgentOutputs({ batchSize: 1_000 })
  return NextResponse.json({ success: true, ...result })
}
