import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { deleteNote, updateNote } from '@/lib/crm-notes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Edit (author only) and pin / unpin (anyone who works chats). */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const json = (await request.json().catch(() => null)) as { body?: unknown; pinned?: unknown } | null
  const result = await updateNote({
    tenantId: auth.tenantId,
    viewer: { userId: auth.userId, role: auth.role },
    noteId: id,
    body: json?.body,
    pinned: json?.pinned,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, note: result.note })
}

/** Soft delete: the author, or an OWNER / ADMIN. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const result = await deleteNote({ tenantId: auth.tenantId, viewer: { userId: auth.userId, role: auth.role }, noteId: id })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
