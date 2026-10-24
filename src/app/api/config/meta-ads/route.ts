import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isSameOriginJson } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { daysLeft } from '@/lib/meta-ads/core'
import { adsAppIdentity, revokeAdsRead } from '@/lib/meta-ads/graph'
import { clearAdSpendCache } from '@/lib/meta-ads/insights'
import { countAdConnectionsOfMetaUser, deleteAdConnection, isMissing064, pickAdAccount, readAdConnection, setAdFxRate } from '@/lib/meta-ads/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const writeLimit = createIdentifierRateLimit({ windowMs: 10 * 60_000, maxRequests: 20, identifier: 'meta-ads-config' })

/** What the card shows. Never the token; the account list only while the owner is picking. */
async function snapshot(tenantId: string) {
  const c = await readAdConnection(tenantId)
  const configured = Boolean(adsAppIdentity().appId && adsAppIdentity().appSecret)
  if (c === 'unavailable') return { available: false, configured, connection: null }
  if (!c) return { available: true, configured, connection: null }
  return {
    available: true,
    configured,
    connection: {
      status: c.status,
      adAccountId: c.adAccountId,
      adAccountName: c.adAccountName,
      currency: c.currency,
      timezoneName: c.timezoneName,
      storeFxRate: c.storeFxRate,
      daysLeft: daysLeft(c.tokenExpiresAt),
      accounts: c.status === 'pending_pick' ? c.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency })) : [],
    },
  }
}

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE })
}

export async function GET(request: NextRequest) {
  // update_config: the account list (names of the person's other ad accounts) is for whoever sets it up.
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ success: true, data: await snapshot(auth.tenantId as string) }, { headers: NO_STORE })
  } catch {
    return fail('No se pudo leer la cuenta publicitaria.', 500)
  }
}

/** { action: 'pick', adAccountId } | { action: 'fx', rate } */
export async function POST(request: NextRequest) {
  if (!isSameOriginJson(request)) return fail('Origen no permitido', 403)
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const tenantId = auth.tenantId as string
  if (!(await writeLimit(`meta-ads:${tenantId}`)).allowed) return fail('Demasiados cambios. Probá en unos minutos.', 429)
  const body = (await request.json().catch(() => null)) as { action?: unknown; adAccountId?: unknown; rate?: unknown } | null
  try {
    if (body?.action === 'pick') {
      const result = await pickAdAccount(tenantId, body.adAccountId)
      if (result === 'no_connection') return fail('Primero conectá tu cuenta publicitaria.', 409)
      if (result === 'not_listed') return fail('Esa cuenta no está entre las que autorizaste.', 400)
      clearAdSpendCache(tenantId)
    } else if (body?.action === 'fx') {
      await setAdFxRate(tenantId, body.rate)
      clearAdSpendCache(tenantId)
    } else {
      return fail('Solicitud inválida', 400)
    }
    return NextResponse.json({ success: true, data: await snapshot(tenantId) }, { headers: NO_STORE })
  } catch (error) {
    if (isMissing064(error)) return fail('Todavía no está disponible.', 503)
    return fail('No se pudo guardar.', 500)
  }
}

/**
 * Disconnect: the row and the token go; ads_read alone is revoked at Meta (best effort, never the whole app).
 * Allowed with restricted billing too: the privacy page promises deletion on disconnect.
 */
export async function DELETE(request: NextRequest) {
  if (!isSameOriginJson(request)) return fail('Origen no permitido', 403)
  const auth = await authenticateAPIWithPermission(request, 'update_config', { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  const tenantId = auth.tenantId as string
  if (!(await writeLimit(`meta-ads:${tenantId}`)).allowed) return fail('Demasiados cambios. Probá en unos minutos.', 429)
  try {
    const removed = await deleteAdConnection(tenantId)
    clearAdSpendCache(tenantId)
    // Revoke ads_read at Meta only when no other business is connected with the same Facebook person
    // (the grant is per person + app: revoking it would break their other business too).
    const shared = removed?.metaUserId ? await countAdConnectionsOfMetaUser(removed.metaUserId).catch(() => 1) : 0
    if (removed?.token && shared === 0) await revokeAdsRead(removed.token, removed.metaUserId).catch(() => false)
    return NextResponse.json({ success: true, data: await snapshot(tenantId) }, { headers: NO_STORE })
  } catch (error) {
    if (isMissing064(error)) return fail('Todavía no está disponible.', 503)
    return fail('No se pudo desconectar.', 500)
  }
}
