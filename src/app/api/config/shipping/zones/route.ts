/**
 * GET/PUT /api/config/shipping/zones — where each of this business's shipping methods delivers and where it
 * accepts contra entrega (SQL 053). Read by code (quote / order gate), never trusted from the AI.
 * PUT { shippingMethodId, coverage, places, allowsCod, codCoverage, codPlaces } — update_config + same-origin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/auditLogger'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { CoverageNotReadyError, loadCoverage, saveCoverage } from '@/lib/shipping/coverage-store'
import type { MethodCoverage } from '@/lib/shipping/coverage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 30, identifier: 'shipping-coverage' })

export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config')
  if (!auth.ok) return auth.response
  try {
    const [available, methods] = await Promise.all([isTableReady('ShippingMethodCoverage'), loadCoverage(auth.tenantId)])
    return NextResponse.json({ success: true, available, methods }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[shipping/zones GET]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al cargar' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  if (!isSameOriginRequest(request)) return NextResponse.json({ success: false, error: 'Origen no permitido.' }, { status: 403 })
  const rate = await limit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429 })
  const len = Number(request.headers.get('content-length') || 0)
  if (!len || len > 64_000) return NextResponse.json({ success: false, error: 'Datos demasiado grandes.' }, { status: 413 })
  try {
    const body = (await request.json().catch(() => null)) as Partial<MethodCoverage> | null
    if (!body || typeof body.shippingMethodId !== 'string') {
      return NextResponse.json({ success: false, error: 'Datos inválidos' }, { status: 400 })
    }
    const saved = await saveCoverage(auth.tenantId, auth.userId, {
      shippingMethodId: body.shippingMethodId,
      coverage: body.coverage,
      places: Array.isArray(body.places) ? body.places : [],
      allowsCod: body.allowsCod === true,
      codCoverage: body.codCoverage,
      codPlaces: Array.isArray(body.codPlaces) ? body.codPlaces : [],
    })
    await logAuditEvent({
      tenantId: auth.tenantId,
      action: 'UPDATE',
      entityType: 'ShippingMethodCoverage',
      entityId: saved.shippingMethodId,
      entityName: 'Cobertura de envío',
      oldValues: null,
      // Only the cleaned, stored values (never raw request data) go into the audit log.
      newValues: { coverage: saved.coverage, places: saved.places.length, allowsCod: saved.allowsCod, codCoverage: saved.codCoverage, codPlaces: saved.codPlaces.length },
      userId: auth.userId,
      userName: auth.userId,
      userRole: String(auth.role),
      reason: 'shipping_coverage_update',
    }).catch(() => undefined)
    return NextResponse.json({ success: true, methods: await loadCoverage(auth.tenantId) })
  } catch (error) {
    if (error instanceof CoverageNotReadyError) {
      return NextResponse.json({ success: false, error: 'Esta función todavía no está activada en la base de datos.' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'METHOD_NOT_FOUND') {
      return NextResponse.json({ success: false, error: 'Ese método de envío no es de este negocio.' }, { status: 404 })
    }
    console.error('[shipping/zones PUT]', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error al guardar' }, { status: 500 })
  }
}
