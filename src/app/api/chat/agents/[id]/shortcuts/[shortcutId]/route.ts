/**
 * PATCH/DELETE /api/chat/agents/[id]/shortcuts/[shortcutId]
 * Cross-tenant ids are 404.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { deleteShortcut, shortcutErrorStatus, updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import type { ShortcutDraft } from '@/lib/soft-ai/shortcuts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; shortcutId: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id, shortcutId } = await context.params
    const patch = (await request.json().catch(() => null)) as Partial<ShortcutDraft> | null
    if (!patch) {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const row = await updateShortcut({
      tenantId: auth.tenantId,
      agentId: id,
      shortcutId,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      patch,
    })
    return NextResponse.json({ success: true, shortcut: row })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code, code: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcuts PATCH]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; shortcutId: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id, shortcutId } = await context.params
    await deleteShortcut({
      tenantId: auth.tenantId,
      agentId: id,
      shortcutId,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code, code: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcuts DELETE]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}
