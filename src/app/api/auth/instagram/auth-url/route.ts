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
      'instagram_basic',
      'instagram_manage_messages',
      'instagram_manage_comments',
      'instagram_content_publish',
      'pages_show_list',
      'pages_read_engagement',
      'business_management',
    ].join(','),
    state: 'instagram_oauth',
  })
  
  const authUrl = `${baseUrl}?${params.toString()}`
  
  return NextResponse.json({ authUrl })
}
