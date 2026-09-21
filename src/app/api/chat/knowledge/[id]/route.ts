/**
 * GET/PATCH/DELETE /api/chat/knowledge/[id]
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  archiveKnowledgeSource,
  getKnowledgeSource,
  mapKnowledgeAdminError,
  updateKnowledgeDraft,
} from '@/lib/soft-ai/knowledge-admin'

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
    return NextResponse.json({ success: true, source })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error' }, { status: 500 })
  }
}

export async function PATCH(
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
    const source = await updateKnowledgeDraft({
      tenantId: auth.tenantId,
      sourceId: id,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      body: typeof rec.body === 'string' ? rec.body : undefined,
      name: typeof rec.name === 'string' ? rec.name : undefined,
    })
    return NextResponse.json({ success: true, source })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al actualizar' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const source = await archiveKnowledgeSource({
      tenantId: auth.tenantId,
      sourceId: id,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true, source })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al archivar' }, { status: 500 })
  }
}
