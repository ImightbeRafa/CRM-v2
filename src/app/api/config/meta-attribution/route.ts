import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission } from '@/lib/rbac'
import { readMetaSalesSettings, senderSwitchOn, writeMetaSalesSettings } from '@/lib/meta-attribution/settings'
import { refreshTenantDatasets } from '@/lib/meta-attribution/dataset'
import { tenantCurrency } from '@/lib/meta-attribution/payment'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const verifyLimit = createIdentifierRateLimit({ windowMs: 10 * 60_000, maxRequests: 10, identifier: 'meta-attribution-verify' })
const NO_STORE = { 'Cache-Control': 'private, no-store' }

async function snapshot(tenantId: string) {
  const [settings, tenant, lines] = await Promise.all([
    readMetaSalesSettings(tenantId),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }),
    prisma.socialAccount.findMany({
      where: { tenantId, isActive: true, platform: 'whatsapp' },
      select: { id: true, displayName: true, displayPhoneNumber: true },
      take: 20,
    }),
  ])
  let datasets: Array<{ socialAccountId: string; status: string; checkedAt: Date | null }> = []
  let sent30d = 0
  try {
    ;[datasets, sent30d] = await Promise.all([
      prisma.metaCapiDataset.findMany({ where: { tenantId }, select: { socialAccountId: true, status: true, checkedAt: true } }),
      prisma.metaConversionEvent.count({ where: { tenantId, status: 'sent', sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    ])
  } catch (error) {
    if (!isMissingTable(error)) throw error
  }
  const byLine = new Map(datasets.map((d) => [d.socialAccountId, d]))
  return {
    enabled: settings.enabled,
    acknowledgedAt: settings.acknowledgedAt,
    testEventCode: settings.testEventCode,
    testEventCodeExpiresAt: settings.testEventCodeExpiresAt,
    currency: tenantCurrency(tenant?.settings),
    serverReady: senderSwitchOn(),
    sentLast30Days: sent30d,
    lines: lines.map((l) => ({
      id: l.id,
      name: l.displayName || l.displayPhoneNumber || 'WhatsApp',
      status: byLine.get(l.id)?.status ?? 'unknown',
      checkedAt: byLine.get(l.id)?.checkedAt?.toISOString() ?? null,
    })),
  }
}

/** Ad-sales reporting settings for this business (owners / admins). */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'view_config')
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ success: true, data: await snapshot(auth.tenantId) }, { headers: NO_STORE })
  } catch (error) {
    console.error('[config/meta-attribution] GET failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500, headers: NO_STORE })
  }
}

/**
 * `{ action: 'save', enabled, acknowledge, testEventCode? }` — turning it on needs the notice
 * accepted (stored with who / when). `{ action: 'verify' }` — re-checks each WhatsApp line's
 * permission + dataset with Meta (read-only for messaging).
 */
export async function PUT(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as {
    action?: unknown
    enabled?: unknown
    acknowledge?: unknown
    testEventCode?: unknown
  } | null
  try {
    if (body?.action === 'verify') {
      if (!(await verifyLimit(`meta-attr-verify:${auth.tenantId}`)).allowed) {
        return NextResponse.json({ success: false, error: 'Demasiados intentos. Probá en unos minutos.' }, { status: 429, headers: NO_STORE })
      }
      // Before the business opts in this only LOOKS (never creates a dataset in their Meta account).
      const current = await readMetaSalesSettings(auth.tenantId)
      await refreshTenantDatasets(auth.tenantId, { createIfMissing: current.enabled })
      return NextResponse.json({ success: true, data: await snapshot(auth.tenantId) }, { headers: NO_STORE })
    }
    if (body?.action !== 'save' || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ success: false, error: 'Solicitud inválida' }, { status: 400, headers: NO_STORE })
    }
    // Accepting the notice (sharing data with Meta for the business) is the owner's decision.
    if (body.enabled && body.acknowledge === true && !hasPermission(auth.role as never, 'manage_tenant')) {
      return NextResponse.json({ success: false, error: 'Solo el dueño del negocio puede aceptar el aviso.' }, { status: 403, headers: NO_STORE })
    }
    const testEventCode =
      body.testEventCode === undefined ? undefined : typeof body.testEventCode === 'string' ? body.testEventCode : null
    const wasEnabled = (await readMetaSalesSettings(auth.tenantId)).enabled
    await writeMetaSalesSettings(auth.tenantId, {
      enabled: body.enabled,
      acknowledge: body.acknowledge === true,
      userId: auth.userId,
      testEventCode,
    })
    if (body.enabled && !wasEnabled) {
      // Just turned on: prepare the lines now (creates the dataset in their own Meta account).
      await refreshTenantDatasets(auth.tenantId, { createIfMissing: true }).catch(() => undefined)
    }
    return NextResponse.json({ success: true, data: await snapshot(auth.tenantId) }, { headers: NO_STORE })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'ACK_REQUIRED') {
      return NextResponse.json({ success: false, error: 'Aceptá el aviso para activarlo.' }, { status: 400, headers: NO_STORE })
    }
    if (code === 'BAD_TEST_CODE') {
      return NextResponse.json({ success: false, error: 'El código de prueba debe empezar con TEST.' }, { status: 400, headers: NO_STORE })
    }
    if (isMissingTable(error)) {
      return NextResponse.json({ success: false, error: 'Todavía no disponible.' }, { status: 503, headers: NO_STORE })
    }
    console.error('[config/meta-attribution] PUT failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ success: false, error: 'Error interno' }, { status: 500, headers: NO_STORE })
  }
}
