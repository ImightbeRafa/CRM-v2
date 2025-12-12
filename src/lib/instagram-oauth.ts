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
      // Instagram permissions (include both old and new names for compatibility)
      'instagram_basic',                    // Old name - works without app review in dev mode
      'instagram_manage_messages',          // Old name - for DMs
      'instagram_business_basic',           // New name - may require app review
      'instagram_business_manage_messages', // New name - may require app review
      // Facebook Page permissions (required for IG Business API)
      'pages_show_list',
      'pages_read_engagement',
      'pages_messaging',                    // Required for message webhooks
      'pages_manage_metadata',              // Needed to read instagram_business_account
      'business_management',
    ].join(','),
    state: 'instagram_oauth',
  })
  
  console.log('[instagram-oauth] Generated auth URL with appId:', appId)
  return `${baseUrl}?${params.toString()}`
}
