/**
 * Shared guard + error mapping for /api/chat/agents/[id]/studio/** routes. Tenant from the session; the agent
 * must belong to it; writes need update_config + same-origin + a per-person rate limit.
 */
import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { StudioNotReadyError, StudioQuotaError, TooManySourcesError } from '@/lib/agent-studio/source-store'
import { AiPausedError, DraftBusyError, DraftDailyLimitError, NoSourcesError } from '@/lib/agent-studio/extract'
import { DraftNotReadyError } from '@/lib/agent-studio/apply'
import { SafeFetchError } from '@/lib/agent-studio/safe-fetch'
import { UploadParseError } from '@/lib/agent-studio/file-parse'
import { InstagramSourceError } from '@/lib/agent-studio/instagram-source'

const writeLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 20, identifier: 'agent-studio-write' })
/** Fetching websites / Instagram / parsing files is heavier: per business. */
const heavyLimit = createIdentifierRateLimit({ windowMs: 10 * 60_000, maxRequests: 20, identifier: 'agent-studio-heavy' })

export type StudioCtx = {
  tenantId: string
  userId: string
  role: string
  actorName: string
  agent: { id: string; name: string }
}

const json = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } })

export async function studioGuard(
  request: NextRequest,
  agentId: string,
  mode: 'read' | 'write' | 'heavy',
): Promise<{ ok: true; ctx: StudioCtx } | { ok: false; response: NextResponse }> {
  const auth = await authenticateAPIWithPermission(request, mode === 'read' ? 'view_config' : 'update_config')
  if (!auth.ok) return { ok: false, response: auth.response }
  if (mode !== 'read') {
    if (!isSameOriginRequest(request)) return { ok: false, response: json(403, 'Origen no permitido.') }
    // JSON writes are small; refuse oversized / unsized bodies before anything is read (uploads have their own cap).
    const isUpload = request.nextUrl.pathname.endsWith('/upload')
    const len = Number(request.headers.get('content-length') || 0)
    if (!isUpload && request.method !== 'DELETE' && (!len || len > 256_000)) return { ok: false, response: json(413, 'Datos demasiado grandes.') }
    const rate = await writeLimit(`${auth.tenantId}:${auth.userId}`)
    if (!rate.allowed) return { ok: false, response: json(429, 'Demasiados cambios. Esperá un momento.') }
    if (mode === 'heavy') {
      const heavy = await heavyLimit(auth.tenantId)
      if (!heavy.allowed) return { ok: false, response: json(429, 'Demasiadas fuentes seguidas. Probá en unos minutos.') }
    }
  }
  const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId: auth.tenantId }, select: { id: true, name: true } })
  if (!agent) return { ok: false, response: json(404, 'Agente no encontrado') }
  const session = auth.session as { user?: { name?: string | null; email?: string | null } } | null
  return {
    ok: true,
    ctx: {
      tenantId: auth.tenantId,
      userId: auth.userId,
      role: String(auth.role),
      actorName: session?.user?.name?.trim() || session?.user?.email?.trim() || auth.userId,
      agent,
    },
  }
}

const FETCH_MESSAGES: Record<string, string> = {
  invalid_url: 'Ese enlace no es válido.',
  protocol: 'Solo se pueden leer enlaces http o https.',
  credentials: 'Ese enlace no se puede leer.',
  host: 'Ese enlace no se puede leer.',
  port: 'Ese enlace no se puede leer.',
  blocked_address: 'Ese enlace no se puede leer.',
  redirects: 'El sitio redirige demasiadas veces.',
  timeout: 'El sitio tardó demasiado en responder.',
  too_large: 'La página es demasiado grande.',
  content_type: 'Ese enlace no es una página que se pueda leer.',
}

const UPLOAD_MESSAGES: Record<string, string> = {
  too_large: 'El archivo pesa más de 9 MB.',
  busy: 'Estamos leyendo otros archivos. Probá en un minuto.',
  pdf_unreadable: 'No pudimos leer ese PDF.',
  docx_too_big: 'Ese Word es demasiado grande.',
  not_docx: 'Ese archivo no es un Word (.docx) válido.',
  image_too_large: 'La imagen es demasiado grande.',
  pdf_too_many_pages: 'El PDF tiene más de 60 páginas.',
  unsupported_type: 'Solo PDF, Word (.docx), texto o fotos (JPG, PNG, WebP).',
  empty: 'El archivo no tiene texto.',
  timeout: 'El archivo tardó demasiado en leerse.',
}

/** Known errors → friendly Spanish + status; unknown → null (caller logs + 500). */
export function studioErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof StudioNotReadyError) return json(409, 'Esta función todavía no está activada en la base de datos.', { code: 'not_ready' })
  if (error instanceof TooManySourcesError) return json(409, 'Este agente ya tiene 30 fuentes. Quitá alguna primero.')
  if (error instanceof DraftDailyLimitError) return json(429, 'Llegaste al límite de borradores de hoy. Probá mañana.')
  if (error instanceof StudioQuotaError) {
    return json(429, error.code === 'photos' ? 'Llegaste al límite de fotos de hoy. Probá mañana.' : 'Se llenó el espacio para fuentes. Quitá alguna primero.')
  }
  if (error instanceof AiPausedError) return json(423, 'La IA de este negocio está en pausa (presupuesto o pausa general).')
  if (error instanceof DraftBusyError) return json(409, 'Se está aplicando un borrador. Esperá un momento.')
  if (error instanceof NoSourcesError) return json(400, 'Agregá al menos una fuente con texto.')
  if (error instanceof DraftNotReadyError) return json(409, 'Este borrador ya no se puede aplicar.')
  if (error instanceof SafeFetchError) return json(400, FETCH_MESSAGES[error.code] || 'No pudimos leer ese enlace.', { code: error.code })
  if (error instanceof UploadParseError) return json(400, UPLOAD_MESSAGES[error.code] || 'No pudimos leer ese archivo.', { code: error.code })
  if (error instanceof InstagramSourceError) return json(400, 'No pudimos leer esa cuenta de Instagram.', { code: error.code })
  return null
}

export function studioFail(where: string, error: unknown): NextResponse {
  const known = studioErrorResponse(error)
  if (known) return known
  console.error(`[agent-studio ${where}]`, error instanceof Error ? error.name : 'unknown')
  return json(500, 'Error inesperado')
}
