/**
 * /api/chat/agents/[id]/activation?socialAccountId=… — test & activate an agent on one channel (F1).
 *  GET    status: latest test run (progress + results) and whether the channel is active.     view_config
 *  POST   { action: 'test' }       start the agent's generated test suite (dry run, background).  update_config
 *  POST   { action: 'activate' }   one click after a green run: the agent answers directly.        update_config
 *  POST   { action: 'deactivate' } stop answering on that channel.                                  update_config
 * tenantId from the session; agent and channel must belong to it; writes are same-origin, rate-limited, audited.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { prisma } from '@/lib/db'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import {
  ACTIVATION_REFUSAL_COPY,
  ActivationRefusal,
  activateAgentChannel,
  deactivateAgentChannel,
} from '@/lib/soft-ai/agent-activation'
import {
  buildSuite,
  latestTestRun,
  startAgentTestRun,
  TestRunBusyElsewhereError,
  TestRunNotReadyError,
} from '@/lib/soft-ai/test-engine/run'
import { aiFullUnlockStatus, parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { CHAT_AGENT_LAYER_V1_FLAG } from '@/lib/soft-ai/agent-types'
import { isPlatformAiPaused } from '@/lib/soft-ai/agent-kill-switch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const activationRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'chat-agent-activation' })

function actorName(auth: { userId: string; session: { user?: { name?: string | null; email?: string | null } } | null }) {
  return auth.session?.user?.name?.trim() || auth.session?.user?.email?.trim() || auth.userId
}

async function scope(tenantId: string, agentId: string, socialAccountId: string) {
  const [agent, account] = await Promise.all([
    prisma.chatAgent.findFirst({
      where: { id: agentId, tenantId },
      select: { id: true, name: true, model: true, version: true, systemInstructions: true, brandFacts: true },
    }),
    socialAccountId
      ? prisma.socialAccount.findFirst({ where: { id: socialAccountId, tenantId }, select: { id: true, platform: true } })
      : null,
  ])
  return { agent, account }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const { id } = await context.params
    const socialAccountId = request.nextUrl.searchParams.get('socialAccountId') || ''
    const { agent, account } = await scope(auth.tenantId, id, socialAccountId)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    if (!account) return NextResponse.json({ success: false, error: 'Canal no encontrado' }, { status: 404 })
    const [run, flag] = await Promise.all([
      latestTestRun(auth.tenantId, agent.id, account.id),
      prisma.tenantFeatureFlag.findFirst({
        where: { tenantId: auth.tenantId, scope: auth.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
        select: { config: true },
      }),
    ])
    const config = parseChatAgentLayerConfig(flag?.config)
    // A green run only activates if it tested TODAY's agent (same version, model and data-built suite).
    const runCurrent = Boolean(
      run &&
        run.status === 'passed' &&
        run.agentVersion === agent.version &&
        run.model === agent.model &&
        run.suiteHash === (await buildSuite(auth.tenantId, agent)).suiteHash,
    )
    const unlock = aiFullUnlockStatus(config, account.id, { agentId: agent.id, model: agent.model, agentVersion: agent.version })
    return NextResponse.json(
      {
        success: true,
        active: unlock.unlocked && config.accountAllowlist.includes(account.id),
        // Data changed since the tests passed: still answering, but ask to re-test.
        retestSuggested: Boolean(unlock.unlocked && run && !runCurrent),
        runCurrent,
        run: run
          ? {
              id: run.id,
              status: run.status,
              total: run.cases.length,
              done: run.cursor,
              summary: run.summary,
              results: run.results,
              cases: run.cases.map((c) => ({ id: c.id, title: c.title, group: c.group })),
              finishedAt: run.finishedAt,
              model: run.model,
              agentVersion: run.agentVersion,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/agents/activation GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await activationRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { action?: unknown; socialAccountId?: unknown } | null
    const action = typeof body?.action === 'string' ? body.action : ''
    const socialAccountId = typeof body?.socialAccountId === 'string' ? body.socialAccountId : ''
    const { agent, account } = await scope(auth.tenantId, id, socialAccountId)
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    if (!account) return NextResponse.json({ success: false, error: 'Canal no encontrado' }, { status: 404 })
    const actor = { actorUserId: auth.userId, actorName: actorName(auth), actorRole: String(auth.role) }

    if (action === 'test') {
      if (await isPlatformAiPaused()) {
        return NextResponse.json({ success: false, error: 'La IA está pausada en Betsy en este momento.' }, { status: 409 })
      }
      const run = await startAgentTestRun({ tenantId: auth.tenantId, agentId: agent.id, socialAccountId: account.id, userId: auth.userId })
      return NextResponse.json({ success: true, runId: run.id, status: run.status })
    }
    if (action === 'activate') {
      const result = await activateAgentChannel({ tenantId: auth.tenantId, agentId: agent.id, socialAccountId: account.id, ...actor })
      return NextResponse.json({ success: true, active: true, agentName: result.agentName })
    }
    if (action === 'deactivate') {
      await deactivateAgentChannel({ tenantId: auth.tenantId, agentId: agent.id, socialAccountId: account.id, ...actor })
      return NextResponse.json({ success: true, active: false })
    }
    return NextResponse.json({ success: false, error: 'Acción inválida' }, { status: 400 })
  } catch (error) {
    if (error instanceof ActivationRefusal) {
      return NextResponse.json({ success: false, code: error.code, error: ACTIVATION_REFUSAL_COPY[error.code] }, { status: 409 })
    }
    if (error instanceof TestRunBusyElsewhereError) {
      return NextResponse.json(
        { success: false, error: 'Ya hay una prueba de este agente corriendo en otro canal. Esperá a que termine.' },
        { status: 409 },
      )
    }
    if (error instanceof TestRunNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las pruebas automáticas todavía no están disponibles.' }, { status: 503 })
    }
    console.error('[chat/agents/activation POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo completar' }, { status: 500 })
  }
}
