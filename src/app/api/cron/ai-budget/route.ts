import { NextRequest, NextResponse } from 'next/server'
import { requireCronBearer } from '@/lib/ops/cron-auth'
import { checkAiBudgets } from '@/lib/ai-usage-admin/budgets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Every 5 min: AI budget alerts (80% / 100%) and optional per-business auto-pause. No-op without budgets. */
export async function GET(request: NextRequest) {
  const denied = requireCronBearer(request)
  if (denied) return denied
  const result = await checkAiBudgets()
  return NextResponse.json({ ok: true, ...result })
}
