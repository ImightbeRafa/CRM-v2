import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Generate Instagram OAuth URL
 * GET /api/auth/instagram/auth-url
 * 
 * IMPORTANT: Uses META_APP_ID (main BetsyCRM app) for both WhatsApp and Instagram
 */
export async function GET() {
  const baseUrl = 'https://www.facebook.com/v21.0/dialog/oauth'
  
  const appId = process.env.META_APP_ID
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`
  
  if (!appId) {
    return NextResponse.json(
      { error: 'Meta App ID not configured' },
      { status: 500 }
    )
  }
  
  if (!process.env.NEXTAUTH_URL) {
    return NextResponse.json(
      { error: 'NEXTAUTH_URL not configured' },
      { status: 500 }
    )
  }

  const oauthState = randomBytes(32).toString('hex')
  
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    auth_type: 'rerequest',
    scope: [
      'instagram_manage_messages',
    ].join(','),
    state: oauthState,
  })
  
  const authUrl = `${baseUrl}?${params.toString()}`

  const response = NextResponse.json({ authUrl })
  response.cookies.set('ig_oauth_state', oauthState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })
  
  return response
}
