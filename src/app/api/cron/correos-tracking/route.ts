import { NextRequest, NextResponse } from 'next/server'
import { requireCronBearer } from '@/lib/ops/cron-auth'
import { runCorreosTrackingSync } from '@/lib/correos/v3/tracking-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Every 5 min: follow open Correos guías (v3 tracking). No-op unless CORREOS_TRACKING_SYNC=1 and v3 is on in production. */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request)
  if (denied) return denied
  try {
    const summary = await runCorreosTrackingSync()
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error('[cron/correos-tracking] failed', error instanceof Error ? error.name : 'error')
    return NextResponse.json({ error: 'Correos tracking sync failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
