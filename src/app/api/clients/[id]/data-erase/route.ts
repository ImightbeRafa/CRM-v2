import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  eraseCustomerData,
  erasureConfirmToken,
  resolveErasureScope,
  verifyErasureConfirmToken,
} from '@/lib/data-subject/erase'
import { logAuditEvent } from '@/lib/auditLogger'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'
import { PII_NO_STORE_HEADERS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const eraseLimit = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 20, identifier: 'customer-erase' })

type RouteContext = { params: Promise<{ id: string }> }

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: PII_NO_STORE_HEADERS })
}

function sameName(typed: unknown, actual: string): boolean {
  const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()
  return typeof typed === 'string' && fold(typed) !== '' && fold(typed) === fold(actual)
}

/**
 * Ley 8968 erasure of one customer (business OWNER only).
 * `{ step: 'preview' }` → what will be removed + a 10-minute confirmation token.
 * `{ confirmToken, typedName }` → erases exactly the previewed data (a changed scope asks again).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'manage_tenant')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return reply(404, { error: 'Not found' })
  if (!(await eraseLimit(`customer-erase:${auth.tenantId}`)).allowed) {
    return reply(429, { error: 'Demasiados intentos. Probá en una hora.' })
  }
  const body = (await request.json().catch(() => null)) as { step?: unknown; confirmToken?: unknown; typedName?: unknown } | null

  try {
    const client = await prisma.client.findFirst({ where: { id, tenantId: auth.tenantId }, select: { name: true } })
    const scope = client ? await resolveErasureScope(auth.tenantId, id) : null
    if (!client || !scope) return reply(404, { error: 'Not found' })

    if (body?.step === 'preview') {
      return reply(200, {
        success: true,
        name: client.name,
        counts: scope.counts,
        openOrders: scope.openOrders,
        confirmToken: scope.openOrders.length ? null : erasureConfirmToken(auth.tenantId, scope),
      })
    }

    if (scope.openOrders.length) {
      return reply(409, {
        error: 'Este cliente tiene pedidos en curso. Cerralos o cancelalos antes de eliminar sus datos.',
        openOrders: scope.openOrders,
      })
    }
    if (!verifyErasureConfirmToken(auth.tenantId, scope, body?.confirmToken)) {
      return reply(409, { error: 'Los datos del cliente cambiaron o la confirmación venció. Revisá de nuevo.' })
    }
    if (!sameName(body?.typedName, client.name)) {
      return reply(400, { error: 'Escribí el nombre del cliente para confirmar.' })
    }

    const result = await eraseCustomerData(auth.tenantId, scope)
    await logAuditEvent({
      action: 'DELETE',
      entityType: 'Client',
      entityId: id,
      description: 'Datos personales del cliente eliminados (Ley 8968)',
      newValues: { counts: result.counts, mediaFilesRemoved: result.mediaFilesRemoved, mediaFilesFailed: result.mediaFilesFailed },
      userId: auth.userId,
      userRole: auth.role,
      tenantId: auth.tenantId,
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    }).catch(() => undefined)
    return reply(200, { success: true, counts: result.counts })
  } catch (error) {
    console.error('[clients/data-erase] failed:', error instanceof Error ? error.name : 'unknown')
    return reply(500, { error: 'No se pudo completar. No se eliminó nada a medias: intentá de nuevo.' })
  }
}
