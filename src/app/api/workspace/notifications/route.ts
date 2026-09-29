import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { listNotifications, markNotificationsRead } from '@/lib/workspace-notifications'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET — my notifications in the session's business (mentions, tasks assigned). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const result = await listNotifications(auth.tenantId, auth.userId)
  return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

/** POST `{ ids?: string[] }` — mark mine as read (all when no ids). */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'rate_limited' }, { status: 429, headers: rate.headers })
  const json = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const marked = await markNotificationsRead(auth.tenantId, auth.userId, json?.ids)
  return NextResponse.json({ success: true, marked })
}
