/**
 * POST /api/chat/agents/[id]/import/extract
 * Reads a shortcut paste and returns a review proposal. Does not write config.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  runShortcutExtract,
  shortcutImportErrorStatus,
} from '@/lib/soft-ai/shortcut-import-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { paste?: unknown } | null
    const paste = typeof body?.paste === 'string' ? body.paste : ''
    const result = await runShortcutExtract({
      tenantId: auth.tenantId,
      agentId: id,
      paste,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const mapped = shortcutImportErrorStatus(error)
    if (mapped) {
      return NextResponse.json({ success: false, error: mapped.code, code: mapped.code }, { status: mapped.status })
    }
    console.error('[shortcut import extract]', error)
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}
