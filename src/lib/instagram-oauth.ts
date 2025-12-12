/**
 * Instagram OAuth helper
 * Uses Facebook Login to access Instagram Business API (Graph API)
 * Instagram Business messaging requires Facebook OAuth, not Instagram Basic Display
 */

export function getInstagramAuthUrl(): string {
  // Use Facebook OAuth for Instagram Business API access
  const baseUrl = 'https://www.facebook.com/v21.0/dialog/oauth'
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '',
    redirect_uri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/instagram/callback`,
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
  return `${baseUrl}?${params.toString()}`
}
