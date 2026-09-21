import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { WHATSAPP_OAUTH_SCOPES } from '@/lib/meta-chat-config'
import { getMetaWhatsAppAppId } from '@/lib/meta-api'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { WA_DIRECT_OAUTH_STATE_COOKIE } from '@/lib/wa-direct-oauth-state'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Direct OAuth URL generator (fallback when FB.login fails with 36008).
 * Requires update_config + persists CSRF `state` in an HttpOnly cookie.
 * GET /api/auth/whatsapp/direct-oauth
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_config')
  if (!auth.ok) {
    return auth.response
  }

  const appId = getMetaWhatsAppAppId()
  const baseUrl = process.env.NEXTAUTH_URL

  if (!appId || !baseUrl) {
    return NextResponse.json(
      {
        error: 'Missing configuration',
        details: 'META_WA_APP_ID/META_APP_ID or NEXTAUTH_URL not set',
      },
      { status: 500 },
    )
  }

  const state = randomBytes(32).toString('hex')
  const redirectUri = `${baseUrl}/api/auth/whatsapp/callback`
  const scopes = WHATSAPP_OAUTH_SCOPES.join(',')

  const oauthUrl = new URL('https://www.facebook.com/v24.0/dialog/oauth')
  oauthUrl.searchParams.set('client_id', appId)
  oauthUrl.searchParams.set('redirect_uri', redirectUri)
  oauthUrl.searchParams.set('scope', scopes)
  oauthUrl.searchParams.set('response_type', 'code')
  oauthUrl.searchParams.set('state', state)

  console.log('[direct-oauth] Generated OAuth URL', {
    redirectUri,
    tenantId: auth.tenantId,
    userId: auth.userId,
  })

  const response = NextResponse.json({
    success: true,
    oauthUrl: oauthUrl.toString(),
    redirectUri,
    instructions: 'Open this URL in a popup window to start OAuth flow',
  })

  response.cookies.set(WA_DIRECT_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return response
}
