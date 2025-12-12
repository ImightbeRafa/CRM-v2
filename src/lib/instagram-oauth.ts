/**
 * Instagram OAuth helper
 * Uses Facebook Login to access Instagram Business API (Graph API)
 * 
 * IMPORTANT: Uses the MAIN Meta App (same as WhatsApp) - NOT a separate Instagram app
 * This simplifies management and app review process.
 * 
 * Required env vars:
 * - META_APP_ID: Your main BetsyCRM app ID (e.g., 1514613536240301)
 * - META_APP_SECRET: Your main app secret
 * - NEXTAUTH_URL: Your app's base URL
 */

export function getInstagramAuthUrl(): string {
  // Use Facebook OAuth for Instagram Business API access
  // ALWAYS use META_APP_ID (the main BetsyCRM app)
  const baseUrl = 'https://www.facebook.com/v21.0/dialog/oauth'
  
  const appId = process.env.META_APP_ID
  const redirectUri = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/instagram/callback`
  
  if (!appId) {
    console.error('[instagram-oauth] META_APP_ID not configured!')
    return ''
  }
  
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    auth_type: 'rerequest',                 // Force re-asking for all permissions
    scope: [
      // Instagram messaging permission (core for /chats)
      'instagram_manage_messages',          // For reading/replying to DMs
      // Facebook Page permissions (required for IG Business API connection)
      'pages_show_list',                    // List pages user manages
      'pages_manage_metadata',              // Webhooks and page config
    ].join(','),
    state: 'instagram_oauth',
  })
  
  console.log('[instagram-oauth] Generated auth URL with appId:', appId)
  return `${baseUrl}?${params.toString()}`
}
