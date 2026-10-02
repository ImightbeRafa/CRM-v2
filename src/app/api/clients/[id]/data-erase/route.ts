import { NextRequest, NextResponse } from 'next/server'
import { prismaRaw } from '@/lib/prisma-tenant'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import {
  eraseCustomerData,
  erasureConfirmToken,
  resolveErasureScope,
  verifyErasureConfirmToken,
} from '@/lib/data-subject/erase'
import { dataSubjectRequestsEnabled, erasureTablesReady } from '@/lib/data-subject/availability'
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
 * Ley 8968 erasure of one customer (business OWNER only). Works even when the plan is restricted
 * for billing (a legal obligation). Off unless DATA_SUBJECT_REQUESTS=1.
 * `{ step: 'preview' }` → what will be removed (incl. orders matched by phone / email, archived
 *   orders) + orders that look in progress + a 10-minute confirmation token.
 * `{ confirmToken, typedName, confirmFinished? }` → erases exactly the previewed data. Orders that
 *   look in progress need `confirmFinished: true` (the owner confirms they are done).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!dataSubjectRequestsEnabled()) return reply(404, { error: 'Not found' })
  const auth = await authenticateAPIWithPermission(request, 'manage_tenant', { skipBillingWriteGuard: true })
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return reply(404, { error: 'Not found' })
  if (!(await eraseLimit(`customer-erase:${auth.tenantId}`)).allowed) {
    return reply(429, { error: 'Demasiados intentos. Probá en una hora.' })
  }
  if (!(await erasureTablesReady())) {
    return reply(503, { error: 'La eliminación de datos todavía no está disponible.' })
  }
  const body = (await request.json().catch(() => null)) as {
    step?: unknown
    confirmToken?: unknown
    typedName?: unknown
    confirmFinished?: unknown
  } | null

  try {
    const client = await prismaRaw.client.findFirst({ where: { id, tenantId: auth.tenantId }, select: { name: true } })
    const scope = client ? await resolveErasureScope(auth.tenantId, id) : null
    if (!client || !scope) return reply(404, { error: 'Not found' })

    if (body?.step === 'preview') {
      return reply(200, {
        success: true,
        name: client.name,
        counts: scope.counts,
        openOrders: scope.openOrders,
        confirmToken: erasureConfirmToken(auth.tenantId, scope),
      })
    }

    if (!verifyErasureConfirmToken(auth.tenantId, scope, body?.confirmToken)) {
      return reply(409, { error: 'Los datos del cliente cambiaron o la confirmación venció. Revisá de nuevo.' })
    }
    if (scope.openOrders.length && body?.confirmFinished !== true) {
      return reply(409, {
        error: 'Este cliente tiene pedidos que parecen en curso. Confirmá que ya terminaron para continuar.',
        openOrders: scope.openOrders,
      })
    }
    if (!sameName(body?.typedName, client.name)) {
      return reply(400, { error: 'Escribí el nombre del cliente para confirmar.' })
    }

    const actor = auth.userId
      ? await prismaRaw.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } }).catch(() => null)
      : null
    const result = await eraseCustomerData(auth.tenantId, scope, {
      userId: auth.userId || null,
      userName: actor?.name || actor?.email || 'Usuario',
      userRole: String(auth.role || 'OWNER'),
      ipAddress: getClientIP(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
    })
    return reply(200, {
      success: true,
      counts: result.counts,
      // Files that could not be removed now are retried automatically every night.
      filesPending: result.mediaFilesFailed,
    })
  } catch (error) {
    console.error('[clients/data-erase] failed:', error instanceof Error ? error.name : 'unknown')
    return reply(500, { error: 'No se pudo completar. No se eliminó nada a medias: intentá de nuevo.' })
  }
}
