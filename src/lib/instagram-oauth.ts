/**
 * Instagram OAuth helper
 * Uses Facebook Login to access Instagram Business API (Graph API)
 * Instagram Business messaging requires Facebook OAuth, not Instagram Basic Display
 */

export function getInstagramAuthUrl(): string {
  // Use Facebook OAuth for Instagram Business API access
  const baseUrl = 'https://www.facebook.com/v18.0/dialog/oauth'
  const params = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || '',
    redirect_uri: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/auth/instagram/callback`,
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
    state: 'instagram_oauth', // Optional: for CSRF protection
  })
  return `${baseUrl}?${params.toString()}`
}
