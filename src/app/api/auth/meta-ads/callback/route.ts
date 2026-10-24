import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { ADS_STATE_COOKIE, readAdsGrant, toAdAccountChoices, verifyAdsState } from '@/lib/meta-ads/core'
import { debugAdsToken, exchangeAdsCode, graphGet, graphGetAll } from '@/lib/meta-ads/graph'
import { isMissing064, saveAdConnectionFromLogin } from '@/lib/meta-ads/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Back to the card with a short result code only (never Meta's text, never a token). Relative Location: inside
 * the container request.url is http://0.0.0.0:3000 (INT-43), and route-handler redirects are not rewritten.
 */
function back(_request: NextRequest, result: string) {
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: `/config/social?ads=${encodeURIComponent(result)}#cuenta-publicitaria`, 'Cache-Control': 'no-store' },
  })
  res.cookies.set(ADS_STATE_COOKIE, '', { path: '/api/auth/meta-ads', maxAge: 0 })
  return res
}

/**
 * GET /api/auth/meta-ads/callback?code=…&state=… — Facebook Login for Business (ads_read) returns here.
 * 1. Session (update_config) + state cookie bound to this business and person.
 * 2. code → long-lived user token (POST, secret in the body); debug_token confirms ads_read + who granted it.
 * 3. The person's ad accounts (/me/adaccounts, cursor paging, only the ones picked in the dialog when Meta
 *    lists them) → one account: connected; several: the owner picks on the card.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl
  if (url.searchParams.get('error')) return back(request, 'cancelled')
  const code = url.searchParams.get('code') || ''
  const stateParam = url.searchParams.get('state') || ''
  if (!code || code.length > 2048) return back(request, 'error')

  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return back(request, auth.response.status === 401 ? 'signin' : 'forbidden')
  const tenantId = auth.tenantId as string
  const userId = auth.userId as string
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  const cookie = request.cookies.get(ADS_STATE_COOKIE)?.value || ''
  if (!verifyAdsState(secret, stateParam, cookie, tenantId, userId)) return back(request, 'state')

  try {
    const exchanged = await exchangeAdsCode(code)
    if (!exchanged.ok) return back(request, 'error')
    const token = exchanged.data.accessToken

    const debug = await debugAdsToken(token)
    if (!debug.ok) return back(request, 'error')
    const grant = readAdsGrant(debug.data.data ?? {})
    if (!grant.granted) return back(request, 'no_permission')
    // Names of the other permissions this person gave the app (the token carries them too); names only, no ids.
    const scopes = Array.isArray(debug.data.data?.scopes) ? (debug.data.data!.scopes as unknown[]).map(String) : []
    console.log('[meta-ads/callback] granted permissions', { other: scopes.filter((s) => s !== 'ads_read').length })
    // Meta's deletion / deauthorize callbacks find the row by this id: never save a connection without it.
    let metaUserId = grant.metaUserId
    if (!metaUserId) {
      const me = await graphGet<{ id?: string }>('me', 'me', { fields: 'id' }, token)
      metaUserId = me.ok && /^\d{1,30}$/.test(String(me.data.id ?? '')) ? String(me.data.id) : null
    }
    if (!metaUserId) return back(request, 'error')

    const accounts = await graphGetAll<Record<string, unknown>>(
      'adaccounts',
      'me/adaccounts',
      { fields: 'account_id,name,currency,timezone_name,account_status', limit: '50' },
      token,
      3,
    )
    if (!accounts.ok) return back(request, accounts.problem === 'missing_permission' ? 'no_permission' : 'error')
    const choices = toAdAccountChoices(accounts.rows, grant.targetIds)
    // Meta's dialog picks are trusted only as a filter; log the counts, never the ids.
    console.log('[meta-ads/callback] accounts', { listed: accounts.rows.length, picked: grant.targetIds?.length ?? null, usable: choices.length })
    if (!choices.length) return back(request, 'no_accounts')

    const status = await saveAdConnectionFromLogin({ tenantId, userId, token, expiresAt: grant.expiresAt, metaUserId, accounts: choices })
    return back(request, status === 'connected' ? 'connected' : 'pick')
  } catch (error) {
    if (isMissing064(error)) return back(request, 'unavailable')
    console.error('[meta-ads/callback] failed', { name: error instanceof Error ? error.name : 'error' })
    return back(request, 'error')
  }
}
