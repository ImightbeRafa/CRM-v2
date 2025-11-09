import { NextRequest, NextResponse } from 'next/server'

/**
 * Direct OAuth URL Generator (Fallback Method)
 * 
 * This endpoint generates a direct OAuth URL that bypasses FB.login()
 * and gives us full control over the redirect_uri parameter.
 * 
 * Use this if FB.login() continues to fail with error 36008.
 */
export async function GET(request: NextRequest) {
  const appId = process.env.META_APP_ID
  const baseUrl = process.env.NEXTAUTH_URL
  
  if (!appId || !baseUrl) {
    return NextResponse.json({ 
      error: 'Missing configuration',
      details: 'META_APP_ID or NEXTAUTH_URL not set'
    }, { status: 500 })
  }
  
  // Generate state for CSRF protection
  const state = crypto.randomUUID()
  
  // Build OAuth URL with explicit redirect_uri
  const redirectUri = `${baseUrl}/config/social`
  const scopes = [
    'whatsapp_business_management',
    'whatsapp_business_messaging'
  ].join(',')
  
  const oauthUrl = new URL('https://www.facebook.com/v24.0/dialog/oauth')
  oauthUrl.searchParams.set('client_id', appId)
  oauthUrl.searchParams.set('redirect_uri', redirectUri)
  oauthUrl.searchParams.set('scope', scopes)
  oauthUrl.searchParams.set('response_type', 'code')
  oauthUrl.searchParams.set('state', state)
  
  console.log('[direct-oauth] Generated OAuth URL:', {
    url: oauthUrl.toString(),
    redirectUri,
    state
  })
  
  return NextResponse.json({
    success: true,
    oauthUrl: oauthUrl.toString(),
    state,
    redirectUri,
    instructions: 'Open this URL in a popup window to start OAuth flow'
  })
}
