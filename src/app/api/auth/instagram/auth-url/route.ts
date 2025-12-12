import { NextResponse } from 'next/server'

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
  
  // Use the MAIN Meta App ID (same app for WhatsApp and Instagram)
  const appId = process.env.META_APP_ID
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`
  
  // Debug logging
  console.log('[instagram/auth-url] Generating OAuth URL', {
    hasAppId: !!appId,
    appIdPreview: appId ? `${appId.slice(0, 4)}...${appId.slice(-4)}` : 'NOT SET',
    redirectUri,
    nextAuthUrl: process.env.NEXTAUTH_URL,
  })
  
  if (!appId) {
    console.error('[instagram/auth-url] META_APP_ID not configured!')
    return NextResponse.json(
      { 
        error: 'Meta App ID not configured',
        hint: 'Set META_APP_ID environment variable to your BetsyCRM app ID (e.g., 1514613536240301)'
      },
      { status: 500 }
    )
  }
  
  if (!process.env.NEXTAUTH_URL) {
    console.error('[instagram/auth-url] NEXTAUTH_URL not configured!')
    return NextResponse.json(
      { 
        error: 'NEXTAUTH_URL not configured',
        hint: 'Set NEXTAUTH_URL to your app URL (e.g., https://your-domain.com)'
      },
      { status: 500 }
    )
  }
  
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    auth_type: 'rerequest',                 // Force re-asking for all permissions
    scope: [
      // Instagram messaging permission (core for /chats)
      'instagram_manage_messages',          // For reading/replying to DMs
    ].join(','),
    state: 'instagram_oauth',
  })
  
  const authUrl = `${baseUrl}?${params.toString()}`
  
  console.log('[instagram/auth-url] Generated URL successfully')
  
  return NextResponse.json({ authUrl, appId })
}
