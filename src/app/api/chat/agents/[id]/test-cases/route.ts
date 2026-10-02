/**
 * GET/POST /api/chat/agents/[id]/test-cases — the team's saved Probar tests for this agent (SQL 047).
 * tenantId from the session; the agent must belong to it; POST needs update_config and is audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { parseSavedTest } from '@/lib/soft-ai/probar-scenarios'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import {
  TestCaseLimitError,
  TestCasesNotReadyError,
  createTestCase,
  listTestCases,
} from '@/lib/soft-ai/probar-test-cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const casesRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'chat-agent-test-cases' })
const notFound = () => NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const result = await listTestCases(auth.tenantId, id)
    if (!result) return notFound()
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[chat/agents/test-cases GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const rate = await casesRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
    const { id } = await context.params
    const parsed = parseSavedTest(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    const caseId = await createTestCase({ tenantId: auth.tenantId, agentId: id, userId: auth.userId, test: parsed.value })
    if (!caseId) return notFound()
    await logAuditEvent({
      action: 'CREATE',
      entityType: 'ChatAgentTestCase',
      entityId: caseId,
      entityName: parsed.value.title,
      description: `Prueba guardada para el agente ${id}`,
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, id: caseId })
  } catch (error) {
    if (error instanceof TestCasesNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las pruebas guardadas todavía no están disponibles.' }, { status: 503 })
    }
    if (error instanceof TestCaseLimitError) {
      return NextResponse.json({ success: false, error: 'Llegaste al máximo de pruebas guardadas (50).' }, { status: 409 })
    }
    console.error('[chat/agents/test-cases POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar' }, { status: 500 })
  }
}
