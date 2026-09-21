/**
 * GET/POST /api/chat/agents/[id]/shortcuts
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  cloneStarterShortcut,
  createShortcut,
  listShortcuts,
  shortcutErrorStatus,
} from '@/lib/soft-ai/shortcut-admin'
import type { ShortcutDraft } from '@/lib/soft-ai/shortcuts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const result = await listShortcuts(auth.tenantId, id)
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcuts GET]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    if (typeof body.templateKey === 'string') {
      const row = await cloneStarterShortcut({
        tenantId: auth.tenantId,
        agentId: id,
        templateKey: body.templateKey,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, shortcut: row })
    }
    const draft = body as unknown as ShortcutDraft
    const row = await createShortcut({
      tenantId: auth.tenantId,
      agentId: id,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      draft,
    })
    return NextResponse.json({ success: true, shortcut: row })
  } catch (error) {
    const mapped = shortcutErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code, code: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcuts POST]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}
