import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { buildCustomerExport, ExportTooLargeError, serializeExport } from '@/lib/data-subject/export'
import { dataSubjectRequestsEnabled } from '@/lib/data-subject/availability'
import { logAuditEvent } from '@/lib/auditLogger'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'
import { PII_NO_STORE_HEADERS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const exportLimit = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 10, identifier: 'customer-export' })

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Ley 8968 access request: download everything about one customer as JSON. Business OWNER only
 * (manage_tenant), 10 per hour per business, audited with counts only (never the data).
 * Off unless DATA_SUBJECT_REQUESTS=1 (standby).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  if (!dataSubjectRequestsEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PII_NO_STORE_HEADERS })
  }
  const auth = await authenticateAPIWithPermission(request, 'manage_tenant')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PII_NO_STORE_HEADERS })
  }
  if (!(await exportLimit(`customer-export:${auth.tenantId}`)).allowed) {
    return NextResponse.json({ error: 'Demasiadas exportaciones. Probá en una hora.' }, { status: 429, headers: PII_NO_STORE_HEADERS })
  }

  let data: Awaited<ReturnType<typeof buildCustomerExport>>
  try {
    data = await buildCustomerExport(auth.tenantId, id)
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json(
        { error: 'Este cliente tiene demasiados datos para una sola descarga. Escribinos a soporte.' },
        { status: 413, headers: PII_NO_STORE_HEADERS },
      )
    }
    console.error('[clients/data-export] failed:', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No se pudo generar la exportación.' }, { status: 500, headers: PII_NO_STORE_HEADERS })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: PII_NO_STORE_HEADERS })

  await logAuditEvent({
    action: 'EXPORT',
    entityType: 'Client',
    entityId: id,
    description: 'Exportación de datos del cliente (Ley 8968)',
    newValues: { counts: data.counts },
    userId: auth.userId,
    userRole: auth.role,
    tenantId: auth.tenantId,
    ipAddress: getClientIP(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 200) ?? null,
  }).catch(() => undefined)

  let json: string
  try {
    json = serializeExport(data)
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return NextResponse.json(
        { error: 'Este cliente tiene demasiados datos para una sola descarga. Escribinos a soporte.' },
        { status: 413, headers: PII_NO_STORE_HEADERS },
      )
    }
    throw error
  }
  const day = new Date().toISOString().slice(0, 10)
  return new NextResponse(json, {
    status: 200,
    headers: {
      ...PII_NO_STORE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="cliente-${id}-${day}.json"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
