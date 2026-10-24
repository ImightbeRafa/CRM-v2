import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { getMetaGraphApiVersion } from '@/lib/meta-api'
import { ADS_READ_SCOPE, ADS_STATE_COOKIE, ADS_STATE_MAX_AGE_S, buildAdsState } from '@/lib/meta-ads/core'
import { adsAppIdentity, adsRedirectUri } from '@/lib/meta-ads/graph'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET /api/auth/meta-ads/auth-url — start "Connect ad account" (Facebook Login for Business, ads_read ONLY).
 * The state cookie is bound to this business + person (meta-ads/core buildAdsState): a tenant switch mid-flow
 * cannot store the token on another business.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) return auth.response
  const { appId, appSecret, configId } = adsAppIdentity()
  const secret = (process.env.NEXTAUTH_SECRET || '').trim()
  if (!appId || !appSecret || !process.env.NEXTAUTH_URL || !secret) {
    return NextResponse.json({ success: false, error: 'La conexión con Meta Ads no está configurada.' }, { status: 503, headers: NO_STORE })
  }

  const { state, cookie } = buildAdsState(secret, randomBytes(24).toString('hex'), auth.tenantId as string, auth.userId as string)
  const params = new URLSearchParams({ client_id: appId, redirect_uri: adsRedirectUri(), response_type: 'code', state })
  if (configId) {
    // The Login-for-Business configuration (Meta dashboard) asks for ads_read only, as a user access token.
    params.set('config_id', configId)
    params.set('override_default_response_type', 'true')
  } else {
    params.set('scope', ADS_READ_SCOPE)
  }
  params.set('auth_type', 'rerequest')

  const response = NextResponse.json(
    { success: true, authUrl: `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth?${params}`, loginForBusiness: Boolean(configId) },
    { headers: NO_STORE },
  )
  response.cookies.set(ADS_STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ADS_STATE_MAX_AGE_S,
    path: '/api/auth/meta-ads',
  })
  return response
}
