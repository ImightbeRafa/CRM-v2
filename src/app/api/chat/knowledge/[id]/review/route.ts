/**
 * POST /api/chat/knowledge/[id]/review — approve | reject (update_config)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  approveKnowledgeSource,
  mapKnowledgeAdminError,
  rejectKnowledgeSource,
} from '@/lib/soft-ai/knowledge-admin'
import { reviewKnowledgeBody } from '@/lib/soft-ai/knowledge-types'
import { getKnowledgeSource } from '@/lib/soft-ai/knowledge-admin'

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
    const source = await getKnowledgeSource(auth.tenantId, id)
    const review = reviewKnowledgeBody(source.body)
    return NextResponse.json({ success: true, source, review })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
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
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const rec = body as Record<string, unknown>
    const action = typeof rec.action === 'string' ? rec.action : ''
    if (action === 'approve') {
      const source = await approveKnowledgeSource({
        tenantId: auth.tenantId,
        sourceId: id,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
      })
      return NextResponse.json({ success: true, source })
    }
    if (action === 'reject') {
      const source = await rejectKnowledgeSource({
        tenantId: auth.tenantId,
        sourceId: id,
        actorUserId: auth.userId,
        actorName: auth.userId,
        actorRole: String(auth.role),
        reason: typeof rec.reason === 'string' ? rec.reason : undefined,
      })
      return NextResponse.json({ success: true, source })
    }
    return NextResponse.json(
      { success: false, error: 'action debe ser approve o reject' },
      { status: 400 },
    )
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error en revisión' }, { status: 500 })
  }
}
