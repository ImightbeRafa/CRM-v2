import { NextRequest, NextResponse } from 'next/server'
import { requireCronBearer } from '@/lib/ops/cron-auth'
import { runChannelSilenceCheck } from '@/lib/channel-silence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Every 5 min: flag busy WhatsApp / Instagram lines that went quiet or lost their token, and alert the owner. */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request)
  if (denied) return denied
  try {
    const summary = await runChannelSilenceCheck()
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error('[cron/channel-silence] failed', error instanceof Error ? error.name : 'error')
    return NextResponse.json({ error: 'Channel silence check failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
