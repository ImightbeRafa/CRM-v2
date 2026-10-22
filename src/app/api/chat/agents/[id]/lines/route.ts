/**
 * GET /api/chat/agents/[id]/lines — the agent page's "Líneas" (Agentes IA 2.0, A): every line of the business with
 * the truth for THIS agent (lineAiStatus: off / checking / on / problem + the single fix) and the latest check run
 * (progress and per-case answers for "Ver respuesta"). view_config; tenantId from the session; read-only except
 * that a check whose step lease expired is resumed (drainAgentTestRun claims it only when free — no new run, no
 * new spend beyond the run already started and budgeted).
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgentAPI } from '@/lib/support/agent-access'
import { prisma } from '@/lib/db'
import { listAgentChannels } from '@/lib/soft-ai/agent-admin'
import { loadLinesAiStatus } from '@/lib/soft-ai/agent-status-server'
import { drainAgentTestRun } from '@/lib/soft-ai/test-engine/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAgentAPI(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const agent = await prisma.chatAgent.findFirst({ where: { id, tenantId: auth.tenantId }, select: { id: true } })
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    const listed = await listAgentChannels(auth.tenantId, agent.id)
    const lines = await loadLinesAiStatus(
      auth.tenantId,
      listed.channels.map((c) => c.id),
      { viewingAgentId: agent.id },
    )
    for (const line of lines.values()) {
      if (line.run && (line.run.status === 'queued' || line.run.status === 'running')) {
        void drainAgentTestRun(auth.tenantId, line.run.id)
      }
    }
    return NextResponse.json(
      {
        success: true,
        schemaReady: listed.schemaReady,
        channels: listed.channels.map((c) => {
          const line = lines.get(c.id)
          return { ...c, ai: line?.status ?? null, run: line?.run ?? null }
        }),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'AGENT_NOT_FOUND') return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    console.error('[chat/agents/lines GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudieron cargar las líneas' }, { status: 500 })
  }
}
