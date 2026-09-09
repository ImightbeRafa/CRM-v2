import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getMetaGraphApiVersion } from '@/lib/meta-api'
import { INSTAGRAM_OAUTH_SCOPES, getInstagramLoginConfigId } from '@/lib/meta-chat-config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Generate Instagram OAuth URL (Facebook Login for Business when config_id is set)
 * GET /api/auth/instagram/auth-url
 */
export async function GET() {
  const baseUrl = `https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth`

  const appId = process.env.META_APP_ID
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`
  const configId = getInstagramLoginConfigId()

  if (!appId) {
    return NextResponse.json({ error: 'Meta App ID not configured' }, { status: 500 })
  }

  if (!process.env.NEXTAUTH_URL) {
    return NextResponse.json({ error: 'NEXTAUTH_URL not configured' }, { status: 500 })
  }

  const oauthState = randomBytes(32).toString('hex')

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state: oauthState,
  })

  if (configId) {
    // Facebook Login for Business — asset picker (Page + IG) lives in the Meta config.
    params.set('config_id', configId)
    params.set('override_default_response_type', 'true')
    params.set('auth_type', 'rerequest')
  } else {
    params.set('auth_type', 'rerequest')
    params.set('scope', INSTAGRAM_OAUTH_SCOPES.join(','))
  }

  const authUrl = `${baseUrl}?${params.toString()}`

  const response = NextResponse.json({
    authUrl,
    loginForBusiness: Boolean(configId),
  })
  response.cookies.set('ig_oauth_state', oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  return response
}
