/**
 * POST /api/chat/agents/[id]/scenario-runs — stores the result of a finished playground run (pass rate per
 * agent version, shown in "Calidad"). The scenarios themselves are played by the playground through the normal
 * Probar endpoint (zero Meta); this only records the outcome. update_config; tenant from the session.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { recordScenarioRun } from '@/lib/soft-ai/probar-test-cases'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    const failures = Array.isArray(body?.failures)
      ? (body.failures as unknown[]).slice(0, 50).map((f) => {
          const o = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
          return { id: String(o.id ?? ''), title: String(o.title ?? ''), reason: String(o.reason ?? '') }
        })
      : []
    const result = await recordScenarioRun({
      tenantId: auth.tenantId,
      agentId: id,
      userId: auth.userId,
      run: {
        examined: num(body?.examined),
        passed: num(body?.passed),
        notRun: num(body?.notRun),
        failures,
        customCount: num(body?.customCount),
      },
    })
    if (!result) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    return NextResponse.json({ success: true, saved: result.saved })
  } catch (error) {
    console.error('[chat/agents/scenario-runs POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar el resultado' }, { status: 500 })
  }
}
