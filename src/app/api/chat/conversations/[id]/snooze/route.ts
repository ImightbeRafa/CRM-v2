import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { parseSnoozeUntil } from '@/lib/chat-work-state'
import { setSnooze } from '@/lib/chat-work-state-server'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function guard(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return { error: auth.response }
  const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return { error: NextResponse.json({ success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' }, { status: 429, headers: rate.headers }) }
  }
  return { auth }
}

/** POST `{ until: ISO }` — posponer este chat hasta esa hora (futura, ≤ 90 días). */
export async function POST(request: NextRequest, context: RouteContext) {
  const g = await guard(request)
  if ('error' in g) return g.error
  const { id } = await context.params
  const json = (await request.json().catch(() => null)) as { until?: unknown } | null
  const until = parseSnoozeUntil(json?.until)
  if (!until) return NextResponse.json({ success: false, error: 'Elegí una hora futura (máximo 90 días).' }, { status: 400 })
  const result = await setSnooze({ tenantId: g.auth.tenantId, conversationId: id, userId: g.auth.userId, until })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, snooze: result.snooze })
}

/** DELETE — despertar el chat ahora. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const g = await guard(request)
  if ('error' in g) return g.error
  const { id } = await context.params
  const result = await setSnooze({ tenantId: g.auth.tenantId, conversationId: id, userId: g.auth.userId, until: null })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, snooze: null })
}
