/**
 * GET/POST /api/chat/knowledge — list + create knowledge sources
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission, type Role } from '@/lib/rbac'
import {
  createKnowledgeSource,
  listKnowledgeSources,
  mapKnowledgeAdminError,
  knowledgeChecklistStatus,
} from '@/lib/soft-ai/knowledge-admin'
import { isChatKnowledgeSchemaReady } from '@/lib/soft-ai/knowledge-schema'
import { isKnowledgeKind } from '@/lib/soft-ai/knowledge-types'
import { KNOWLEDGE_CHECKLIST_CARDS } from '@/lib/soft-ai/knowledge-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response

    const url = new URL(request.url)
    if (url.searchParams.get('checklist') === '1') {
      const status = await knowledgeChecklistStatus(auth.tenantId)
      const cards = KNOWLEDGE_CHECKLIST_CARDS.map((card) => {
        let approvedCount = 0
        let draftCount = 0
        for (const r of status.rows) {
          if (r.kind !== card.kind) continue
          if (r.status === 'approved') approvedCount += r._count._all
          if (r.status === 'draft') draftCount += r._count._all
        }
        const statusLabel = !status.schemaReady
          ? 'SQL 028 pendiente'
          : approvedCount > 0
            ? `${approvedCount} aprobado${approvedCount === 1 ? '' : 's'}`
            : draftCount > 0
              ? `${draftCount} borrador${draftCount === 1 ? '' : 'es'}`
              : card.id === 'precios'
                ? 'Usar inventario en vivo'
                : 'Sin fuentes'
        return {
          id: card.id,
          title: card.title,
          hint: card.hint,
          inventoryWins: card.inventoryWins,
          approvedCount,
          draftCount,
          statusLabel,
        }
      })
      return NextResponse.json({
        success: true,
        schemaReady: status.schemaReady,
        cards,
        canEdit: hasPermission(auth.role as Role, 'update_config'),
      })
    }

    const kindParam = url.searchParams.get('kind')
    const statusParam = url.searchParams.get('status') || undefined
    const agentId = url.searchParams.get('agentId') || undefined
    const kind = kindParam && isKnowledgeKind(kindParam) ? kindParam : undefined

    const schemaReady = await isChatKnowledgeSchemaReady()
    if (!schemaReady) {
      return NextResponse.json({
        success: true,
        schemaReady: false,
        sources: [],
        canEdit: hasPermission(auth.role as Role, 'update_config'),
      })
    }

    const sources = await listKnowledgeSources({
      tenantId: auth.tenantId,
      kind,
      status: statusParam,
      agentId,
    })
    return NextResponse.json({
      success: true,
      schemaReady: true,
      sources,
      canEdit: hasPermission(auth.role as Role, 'update_config'),
    })
  } catch (error) {
    console.error('[chat/knowledge GET]', error)
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al listar conocimiento' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'JSON requerido' }, { status: 400 })
    }
    const rec = body as Record<string, unknown>
    const source = await createKnowledgeSource({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      actorName: auth.userId,
      actorRole: String(auth.role),
      kind: typeof rec.kind === 'string' ? rec.kind : '',
      name: typeof rec.name === 'string' ? rec.name : '',
      body: typeof rec.body === 'string' ? rec.body : '',
      socialAccountId:
        typeof rec.socialAccountId === 'string' ? rec.socialAccountId : null,
      metadata:
        rec.metadata && typeof rec.metadata === 'object' && !Array.isArray(rec.metadata)
          ? (rec.metadata as Record<string, unknown>)
          : null,
    })
    return NextResponse.json({ success: true, source })
  } catch (error) {
    console.error('[chat/knowledge POST]', error)
    const mapped = mapKnowledgeAdminError(error)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    return NextResponse.json({ success: false, error: 'Error al crear' }, { status: 500 })
  }
}
