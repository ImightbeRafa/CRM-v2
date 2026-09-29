import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { deleteNote, updateNote } from '@/lib/crm-notes'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

async function limited(tenantId: string, userId: string) {
  const rate = await workspaceWriteRateLimit(`${tenantId}:${userId}`)
  return rate.allowed ? null : NextResponse.json({ success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' }, { status: 429, headers: rate.headers })
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Edit (author only), pin / unpin (anyone who works chats), scope chat ↔ client (author / OWNER / ADMIN). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tooMany = await limited(auth.tenantId, auth.userId)
  if (tooMany) return tooMany
  const { id } = await context.params
  const json = (await request.json().catch(() => null)) as { body?: unknown; pinned?: unknown; scope?: unknown } | null
  const result = await updateNote({
    tenantId: auth.tenantId,
    viewer: { userId: auth.userId, role: auth.role },
    noteId: id,
    body: json?.body,
    pinned: json?.pinned,
    scope: json?.scope,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, note: result.note })
}

/** Soft delete: the author, or an OWNER / ADMIN. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const tooMany = await limited(auth.tenantId, auth.userId)
  if (tooMany) return tooMany
  const { id } = await context.params
  const result = await deleteNote({ tenantId: auth.tenantId, viewer: { userId: auth.userId, role: auth.role }, noteId: id })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
