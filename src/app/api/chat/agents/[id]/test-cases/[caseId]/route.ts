/**
 * DELETE /api/chat/agents/[id]/test-cases/[caseId] — remove one saved Probar test (update_config, audited).
 * A test of another business or another agent is a plain 404.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { TestCasesNotReadyError, deleteTestCase } from '@/lib/soft-ai/probar-test-cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; caseId: string }> },
) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const { id, caseId } = await context.params
    const removed = await deleteTestCase(auth.tenantId, id, caseId)
    if (!removed) return NextResponse.json({ success: false, error: 'Prueba no encontrada' }, { status: 404 })
    await logAuditEvent({
      action: 'DELETE',
      entityType: 'ChatAgentTestCase',
      entityId: caseId,
      description: `Prueba borrada del agente ${id}`,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof TestCasesNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las pruebas guardadas todavía no están disponibles.' }, { status: 503 })
    }
    console.error('[chat/agents/test-cases DELETE]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo borrar' }, { status: 500 })
  }
}
