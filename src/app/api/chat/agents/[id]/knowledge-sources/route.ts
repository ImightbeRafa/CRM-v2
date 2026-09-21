/**
 * GET/POST/DELETE /api/chat/agents/[id]/knowledge-sources — bind approved knowledge
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  bindKnowledgeToAgent,
  listKnowledgeSources,
  mapKnowledgeAdminError,
  unbindKnowledgeFromAgent,
} from '@/lib/soft-ai/knowledge-admin'
import { prisma } from '@/lib/db'

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
    const sources = await listKnowledgeSources({
      tenantId: auth.tenantId,
      agentId: id,
    })
    const links = await prisma.chatAgentKnowledgeSource.findMany({
      where: { tenantId: auth.tenantId, agentId: id },
      select: { sourceId: true, priority: true },
    })
    return NextResponse.json({
      success: true,
      sources,
      knowledgeSourceIds: links.map((l) => l.sourceId),
      links,
    })
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
    const sourceId = typeof rec.sourceId === 'string' ? rec.sourceId : ''
    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId requerido' }, { status: 400 })
    }
    const link = await bindKnowledgeToAgent({
      tenantId: auth.tenantId,
      agentId: id,
      sourceId,
      priority: typeof rec.priority === 'number' ? rec.priority : 100,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true, link })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al vincular' }, { status: 500 })
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
    const url = new URL(request.url)
    const sourceId = url.searchParams.get('sourceId') || ''
    if (!sourceId) {
      return NextResponse.json({ success: false, error: 'sourceId requerido' }, { status: 400 })
    }
    await unbindKnowledgeFromAgent({
      tenantId: auth.tenantId,
      agentId: id,
      sourceId,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al desvincular' }, { status: 500 })
  }
}
