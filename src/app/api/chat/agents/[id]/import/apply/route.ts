/**
 * POST /api/chat/agents/[id]/import/apply
 * One reviewed write of brand facts and playbooks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  runShortcutApply,
  shortcutImportErrorStatus,
} from '@/lib/soft-ai/shortcut-import-server'
import type { ShortcutImportApplyRequest } from '@/lib/soft-ai/shortcut-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function asDecisions(value: unknown): ShortcutImportApplyRequest['facts'] | null {
  if (!Array.isArray(value)) return null
  const rows: ShortcutImportApplyRequest['facts'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string') return null
    if (row.decision !== 'include' && row.decision !== 'exclude') return null
    if (typeof row.value !== 'string') return null
    rows.push({ id: row.id, decision: row.decision, value: row.value })
  }
  return rows
}

function asShortcuts(value: unknown): ShortcutImportApplyRequest['shortcuts'] | null {
  if (!Array.isArray(value)) return null
  const rows: ShortcutImportApplyRequest['shortcuts'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.body !== 'string') {
      return null
    }
    if (row.decision !== 'include' && row.decision !== 'exclude') return null
    rows.push({
      id: row.id,
      decision: row.decision,
      title: row.title,
      body: row.body,
      isActive: row.isActive !== false,
    })
  }
  return rows
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
    const facts = asDecisions(body?.facts)
    const shortcuts = asShortcuts(body?.shortcuts)
    if (
      !body ||
      body.reviewed !== true ||
      body.schemaVersion !== 1 ||
      typeof body.proposalToken !== 'string' ||
      !facts ||
      !shortcuts
    ) {
      return NextResponse.json({ success: false, error: 'IMPORT_TOKEN_INVALID', code: 'IMPORT_TOKEN_INVALID' }, { status: 400 })
    }
    const result = await runShortcutApply({
      tenantId: auth.tenantId,
      agentId: id,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      request: {
        schemaVersion: 1,
        reviewed: true,
        proposalToken: body.proposalToken,
        facts,
        shortcuts,
      },
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const mapped = shortcutImportErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code, code: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcut import apply]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}
