/**
 * POST /api/chat/agents/[id]/tune — "Corregir" (Agentes IA 2.0 · E). The owner says how the agent should have
 * answered; it is saved as an example (default), a saved reply or a selling rule (agent-tuning.ts).
 * update_config; same-origin; rate-limited per person; tenantId from the session (the agent must belong to it);
 * body ≤ 16 KB (checked before parsing); refuses confirmation wording, payment numbers, links, Betsy markers and
 * amounts the agent can't quote (400, Spanish copy); audited.
 * Body: { messageId?, customerMessage, agentReply?, correctedReply, note?, saveAs: 'example' | 'saved_reply' | 'rule', title? }
 *   messageId (real chats): the server loads the AI reply and the customer message itself (INT-107).
 *
 * GET /api/chat/agents/[id]/tune?messageId=… — what the panel shows for a real chat's AI message: the customer's
 * question as the agent will see it (sanitized), the reply, the agent's name, and whether code sent it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isSameOriginRequest } from '@/lib/same-origin'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { parseTuneBody, TUNE_BODY_MAX_BYTES } from '@/lib/soft-ai/agent-tuning-core'
import { tuneAgent, tunePanelSource, TuneRefusal } from '@/lib/soft-ai/agent-tuning'
import { mapKnowledgeAdminError } from '@/lib/soft-ai/knowledge-admin'
import { shortcutErrorStatus } from '@/lib/soft-ai/shortcut-admin'
import { SalesRulesTooLargeError, SalesSetupNotReadyError } from '@/lib/soft-ai/agent-sales-setup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const tuneRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 12, identifier: 'chat-agent-tune' })
const tuneReadRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 60, identifier: 'chat-agent-tune-read' })

function actorName(auth: { userId: string; session: { user?: { name?: string | null; email?: string | null } } | null }) {
  return auth.session?.user?.name?.trim() || auth.session?.user?.email?.trim() || auth.userId
}

const tooLarge = () => NextResponse.json({ success: false, error: 'La corrección es demasiado larga.' }, { status: 413 })

/** Reads the body as text with a size cap (content-length first, then the real length). */
async function readCappedJson(request: NextRequest): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(declared) && declared > TUNE_BODY_MAX_BYTES) return { ok: false, response: tooLarge() }
  const text = await request.text().catch(() => '')
  if (text.length > TUNE_BODY_MAX_BYTES || Buffer.byteLength(text, 'utf8') > TUNE_BODY_MAX_BYTES) return { ok: false, response: tooLarge() }
  try {
    return { ok: true, value: text ? JSON.parse(text) : null }
  } catch {
    return { ok: true, value: null }
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    const rate = await tuneReadRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiadas consultas seguidas. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const messageId = (request.nextUrl.searchParams.get('messageId') || '').trim()
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageId)) return NextResponse.json({ success: false, error: 'Mensaje inválido.' }, { status: 400 })
    const source = await tunePanelSource({ tenantId: auth.tenantId, agentId: id, messageId })
    return NextResponse.json({ success: true, ...source })
  } catch (error) {
    if (error instanceof TuneRefusal) {
      return NextResponse.json({ success: false, code: error.code, error: error.userMessage }, { status: error.status })
    }
    console.error('[chat/agents/tune GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo cargar el mensaje.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'update_config')
    if (!auth.ok) return auth.response
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
    }
    const rate = await tuneRateLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) {
      return NextResponse.json({ success: false, error: 'Demasiadas correcciones seguidas. Esperá un momento.' }, { status: 429, headers: rate.headers })
    }
    const { id } = await context.params
    const raw = await readCappedJson(request)
    if (!raw.ok) return raw.response
    const parsed = parseTuneBody(raw.value)
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
    const result = await tuneAgent({
      tenantId: auth.tenantId,
      agentId: id,
      body: parsed.value,
      actorUserId: auth.userId,
      actorName: actorName(auth),
      actorRole: String(auth.role),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof TuneRefusal) {
      return NextResponse.json({ success: false, code: error.code, error: error.userMessage }, { status: error.status })
    }
    // Fallbacks (agent-tuning.ts maps these per save type first).
    if (error instanceof SalesRulesTooLargeError) {
      return NextResponse.json({ success: false, error: 'Las reglas de venta ya están llenas. Guardá esta corrección como ejemplo.' }, { status: 400 })
    }
    if (error instanceof SalesSetupNotReadyError) {
      return NextResponse.json({ success: false, error: 'Las reglas de venta todavía no están disponibles.' }, { status: 503 })
    }
    const knowledge = mapKnowledgeAdminError(error)
    if (knowledge) return NextResponse.json({ ...knowledge.body, error: 'No se pudo guardar la corrección. Intentá de nuevo.' }, { status: knowledge.status })
    const shortcut = shortcutErrorStatus(error)
    if (shortcut) {
      const msg = shortcut.code === 'confirmation_wording'
        ? 'La respuesta dice que un pago o pedido está confirmado. El agente nunca confirma pagos ni pedidos.'
        : 'No se pudo guardar la respuesta guardada.'
      return NextResponse.json({ success: false, code: shortcut.code, error: msg }, { status: shortcut.status })
    }
    console.error('[chat/agents/tune POST]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'No se pudo guardar la corrección.' }, { status: 500 })
  }
}
