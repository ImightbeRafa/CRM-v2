import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Generate Instagram OAuth URL
 * GET /api/auth/instagram/auth-url
 */
export async function GET() {
  const baseUrl = 'https://www.facebook.com/v21.0/dialog/oauth'
  
  const appId = process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/instagram/callback`
  
  if (!appId) {
    return NextResponse.json(
      { error: 'Instagram App ID not configured' },
      { status: 500 }
    )
  }
  
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      // Core permissions for Instagram DM management
      'instagram_business_basic',           // Required base permission
      'instagram_business_manage_messages', // Send/receive DMs
      // Facebook Page permissions (required for IG Business API)
      'pages_show_list',
      'pages_read_engagement',
      'pages_messaging',                    // Required for message webhooks
      'business_management',
    ].join(','),
    state: 'instagram_oauth',
  })
  
  const authUrl = `${baseUrl}?${params.toString()}`
  
  return NextResponse.json({ authUrl })
}
