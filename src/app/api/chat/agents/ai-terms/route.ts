/**
 * GET/POST /api/chat/agents/ai-terms — the business's opt-in to AI features (revocable).
 * Until the CURRENT version is accepted, agents never send customer messages to an AI provider and the real-send
 * approval is refused. Accepting or revoking needs update_config (owners/admins), is audited and records who/when/version.
 * tenantId from the session; the acceptance lives in the tenant's own chat_agent_layer_v1 config row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { logAuditEvent } from '@/lib/auditLogger'
import { prisma } from '@/lib/db'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import {
  AI_TERMS_CHECKBOX,
  AI_TERMS_LINKS,
  AI_TERMS_POINTS,
  AI_TERMS_TITLE,
  AI_TERMS_VERSION,
} from '@/lib/soft-ai/ai-terms'
import { aiTermsAccepted, parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { CHAT_AGENT_LAYER_V1_FLAG } from '@/lib/soft-ai/agent-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const termsRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'chat-agent-ai-terms' })

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config')
    if (!auth.ok) return auth.response
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId: auth.tenantId, scope: auth.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
      select: { config: true },
    })
    const config = parseChatAgentLayerConfig(flag?.config)
    return NextResponse.json(
      {
        success: true,
        version: AI_TERMS_VERSION,
        accepted: aiTermsAccepted(config),
        record: config.aiTerms
          ? { version: config.aiTerms.version, acceptedAt: config.aiTerms.acceptedAt, acceptedByName: config.aiTerms.acceptedByName }
          : null,
        title: AI_TERMS_TITLE,
        points: AI_TERMS_POINTS,
        checkbox: AI_TERMS_CHECKBOX,
        links: AI_TERMS_LINKS,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat/agents/ai-terms GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo cargar' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const rate = await termsRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const body = (await request.json().catch(() => null)) as { accept?: unknown; version?: unknown } | null
    if (typeof body?.accept !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Falta indicar si acepta o revoca.' }, { status: 400 })
    }
    const accept = body.accept
    // The acceptance is bound to the exact wording shown: a stale page cannot accept a newer text.
    if (accept && body.version !== AI_TERMS_VERSION) {
      return NextResponse.json(
        { success: false, error: 'El texto cambió. Recargá la página y leelo de nuevo.', code: 'VERSION_MISMATCH' },
        { status: 409 },
      )
    }
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } })
    const who = (user?.name || user?.email || '').slice(0, 120)
    const at = new Date().toISOString()
    const { before, after } = await mutateChatAgentLayerConfig(auth.tenantId, (config) => ({
      ...config,
      aiTerms: accept
        ? { version: AI_TERMS_VERSION, acceptedAt: at, acceptedByUserId: auth.userId, acceptedByName: who }
        : null,
      aiTermsRevoked: accept
        ? config.aiTermsRevoked
        : config.aiTerms
          ? { revokedAt: at, revokedByUserId: auth.userId, version: config.aiTerms.version }
          : config.aiTermsRevoked,
    }))
    await logAuditEvent({
      action: 'UPDATE',
      entityType: 'AiTermsAcceptance',
      entityId: auth.tenantId,
      description: accept
        ? `Aceptó el uso de IA (versión ${AI_TERMS_VERSION})`
        : 'Revocó la autorización de IA: los agentes dejan de responder',
      oldValues: { accepted: aiTermsAccepted(before), version: before.aiTerms?.version ?? null },
      newValues: { accepted: aiTermsAccepted(after), version: after.aiTerms?.version ?? null },
      userId: auth.userId,
      userName: who,
      userRole: auth.role,
      tenantId: auth.tenantId,
    }).catch(() => {})
    return NextResponse.json({ success: true, accepted: aiTermsAccepted(after) })
  } catch (error) {
    console.error('[chat/agents/ai-terms POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar' }, { status: 500 })
  }
}
