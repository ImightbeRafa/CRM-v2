/**
 * POST /api/chat/agents/[id]/lines/[socialAccountId]/power  { on: boolean, takeOver?: boolean }
 * The one switch per line (Agentes IA 2.0, A). update_config; tenantId from the session; agent and line must belong
 * to it; same-origin; rate-limited per person and (for ON, which may start a paid check) per business; audited.
 *  ON : refuses with { code, error } (409) when AI is not enabled for the business (no flag writes), AI terms are
 *       missing, AI is paused, the model/provider/products are not ready, or another agent has the line on; else
 *       turns on now (a still-valid green check) or starts the 6-case check → { state: 'checking', runId, total }.
 *       `takeOver` moves a line another agent serves (with the line off there) to this agent — explicit, never silent.
 *  OFF: cancels pending checks, removes the activation and the allowlist entry; the binding stays.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAgentAPI } from '@/lib/support/agent-access'
import { prisma } from '@/lib/db'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { ACTIVATION_REFUSAL_COPY, ActivationRefusal, powerOffLine, powerOnLine } from '@/lib/soft-ai/agent-activation'
import {
  TestRunBudgetError,
  TestRunBusyElsewhereError,
  TestRunDailyLimitError,
  TestRunNoProductsError,
  TestRunNotReadyError,
} from '@/lib/soft-ai/test-engine/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const powerRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'chat-agent-line-power' })
/** Per business: turning a line on may start a check that uses Betsy's AI keys (same bucket as the test button). */
const testRunTenantLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 4, identifier: 'chat-agent-test-run' })

function actorName(auth: { userId: string; session: { user?: { name?: string | null; email?: string | null } } | null }) {
  return auth.session?.user?.name?.trim() || auth.session?.user?.email?.trim() || auth.userId
}

const k = (n: number) => `${Math.round(n / 1000).toLocaleString('es-CR')} mil`

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; socialAccountId: string }> }) {
  try {
    const auth = await authenticateAgentAPI(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await powerRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id, socialAccountId } = await context.params
    const body = (await request.json().catch(() => null)) as { on?: unknown; takeOver?: unknown } | null
    if (!body || typeof body.on !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Falta indicar si se enciende o se apaga.' }, { status: 400 })
    }
    const [agent, account] = await Promise.all([
      prisma.chatAgent.findFirst({ where: { id, tenantId: auth.tenantId }, select: { id: true } }),
      prisma.socialAccount.findFirst({ where: { id: socialAccountId, tenantId: auth.tenantId }, select: { id: true } }),
    ])
    if (!agent) return NextResponse.json({ success: false, error: 'Agente no encontrado' }, { status: 404 })
    if (!account) return NextResponse.json({ success: false, error: 'Línea no encontrada' }, { status: 404 })
    const actor = { actorUserId: auth.userId, actorName: actorName(auth), actorRole: String(auth.role) }

    if (!body.on) {
      await powerOffLine({ tenantId: auth.tenantId, agentId: agent.id, socialAccountId: account.id, ...actor })
      return NextResponse.json({ success: true, state: 'off' })
    }
    const tenantRate = await testRunTenantLimit(auth.tenantId)
    if (!tenantRate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiadas pruebas seguidas. Esperá un momento.' }, { status: 429, headers: tenantRate.headers })
    }
    const result = await powerOnLine({
      tenantId: auth.tenantId,
      agentId: agent.id,
      socialAccountId: account.id,
      takeOver: body.takeOver === true,
      ...actor,
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof ActivationRefusal) {
      return NextResponse.json({ success: false, code: error.code, error: ACTIVATION_REFUSAL_COPY[error.code] }, { status: 409 })
    }
    if (error instanceof TestRunDailyLimitError) {
      return NextResponse.json(
        { success: false, code: 'TEST_DAILY_LIMIT', error: 'Se alcanzó el límite de pruebas de hoy para este negocio. Volvé a intentar mañana.' },
        { status: 429 },
      )
    }
    if (error instanceof TestRunBudgetError) {
      return NextResponse.json(
        {
          success: false,
          code: 'TEST_BUDGET',
          error:
            error.neededTokens > error.capTokens
              ? `La prueba necesita unos ${k(error.neededTokens)} tokens y el presupuesto diario de pruebas es de ${k(error.capTokens)}. No se gastó nada; hay que subir el presupuesto de pruebas.`
              : `No alcanza el presupuesto de pruebas de hoy (quedan ${k(error.remainingTokens)} tokens, la prueba necesita unos ${k(error.neededTokens)}). No se gastó nada; se renueva a las 6:00 pm (hora de Costa Rica).`,
        },
        { status: 429 },
      )
    }
    if (error instanceof TestRunBusyElsewhereError) {
      return NextResponse.json(
        { success: false, code: 'TEST_BUSY', error: 'Este agente se está probando en otra línea. Esperá a que termine y volvé a encender.' },
        { status: 409 },
      )
    }
    if (error instanceof TestRunNoProductsError) {
      return NextResponse.json(
        { success: false, code: 'NO_PRODUCTS', error: 'Este agente no tiene productos: elegí qué vende (② Productos) y volvé a encender.' },
        { status: 409 },
      )
    }
    if (error instanceof TestRunNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las pruebas automáticas todavía no están disponibles.' }, { status: 503 })
    }
    const msg = error instanceof Error ? error.message : ''
    if (msg === 'AGENT_NOT_FOUND' || msg === 'SOCIAL_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'No encontrado' }, { status: 404 })
    }
    console.error('[chat/agents/lines/power POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo completar' }, { status: 500 })
  }
}
