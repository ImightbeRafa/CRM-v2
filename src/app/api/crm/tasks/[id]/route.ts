import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { updateTask } from '@/lib/crm-tasks'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function limited(tenantId: string, userId: string) {
  const rate = await workspaceWriteRateLimit(`${tenantId}:${userId}`)
  return rate.allowed ? null : NextResponse.json({ success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' }, { status: 429, headers: rate.headers })
}

/** PATCH `{ status?: 'open'|'done', title?, dueAt?, assigneeUserId? }` */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tooMany = await limited(auth.tenantId, auth.userId)
  if (tooMany) return tooMany
  const { id } = await context.params
  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const result = await updateTask({
    tenantId: auth.tenantId,
    userId: auth.userId,
    taskId: id,
    status: json?.status,
    title: json?.title,
    dueAt: json?.dueAt,
    assigneeUserId: json?.assigneeUserId,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, task: result.task })
}

/** DELETE — cancel (kept for the history). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tooMany = await limited(auth.tenantId, auth.userId)
  if (tooMany) return tooMany
  const { id } = await context.params
  const result = await updateTask({ tenantId: auth.tenantId, userId: auth.userId, taskId: id, status: 'canceled' })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
