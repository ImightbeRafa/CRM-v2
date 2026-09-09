/**
 * Canonical Meta / Betsy Chat configuration.
 * CRM inbox (Instagram + WhatsApp customers) is separate from the staff WhatsApp bot.
 */

export const META_CHAT_GRAPH_API_VERSION = 'v24.0'

export const META_CHAT_PRODUCTION_ORIGIN = 'https://betsycrm.com'

export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_manage_metadata',
  'pages_messaging',
  'business_management',
] as const

export const WHATSAPP_OAUTH_SCOPES = [
  'whatsapp_business_management',
  'whatsapp_business_messaging',
  'business_management',
] as const

export type MetaChatEnvKey =
  | 'META_APP_ID'
  | 'NEXT_PUBLIC_META_APP_ID'
  | 'META_APP_SECRET'
  | 'META_WEBHOOK_VERIFY_TOKEN'
  | 'NEXT_PUBLIC_FB_LOGIN_CONFIG_ID'
  | 'META_GRAPH_API_VERSION'
  | 'NEXT_PUBLIC_META_GRAPH_API_VERSION'
  | 'NEXTAUTH_URL'
  | 'WHATSAPP_ACCESS_TOKEN'
  | 'WHATSAPP_PHONE_NUMBER_ID'
  | 'WHATSAPP_VERIFY_TOKEN'
  | 'WHATSAPP_BUSINESS_ACCOUNT_ID'

const INBOX_REQUIRED_ENV: MetaChatEnvKey[] = [
  'META_APP_ID',
  'NEXT_PUBLIC_META_APP_ID',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'NEXTAUTH_URL',
]

const INBOX_RECOMMENDED_ENV: MetaChatEnvKey[] = [
  'NEXT_PUBLIC_FB_LOGIN_CONFIG_ID',
  'META_GRAPH_API_VERSION',
  'NEXT_PUBLIC_META_GRAPH_API_VERSION',
]

const STAFF_BOT_ENV: MetaChatEnvKey[] = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
]

export function envFlag(key: MetaChatEnvKey): { key: MetaChatEnvKey; set: boolean } {
  const value = (process.env[key] || '').trim()
  return { key, set: value.length > 0 }
}

export function getMetaChatPublicUrls(origin = META_CHAT_PRODUCTION_ORIGIN) {
  const base = origin.replace(/\/$/, '')
  return {
    origin: base,
    privacyPolicy: `${base}/privacy`,
    termsOfService: `${base}/terms`,
    dataDeletionInstructions: `${base}/data-deletion`,
    dataDeletionCallback: `${base}/api/auth/instagram/data-deletion`,
    inboxWebhook: `${base}/api/chat/webhook`,
    instagramOAuthRedirect: `${base}/api/auth/instagram/callback`,
    socialConfig: `${base}/config/social`,
    inbox: `${base}/chats`,
    staffBotWebhook: `${base}/api/bot/whatsapp/webhook`,
  }
}

export function getMetaChatReadiness() {
  const origin = (process.env.NEXTAUTH_URL || META_CHAT_PRODUCTION_ORIGIN).trim() || META_CHAT_PRODUCTION_ORIGIN
  const inboxRequired = INBOX_REQUIRED_ENV.map(envFlag)
  const inboxRecommended = INBOX_RECOMMENDED_ENV.map(envFlag)
  const staffBot = STAFF_BOT_ENV.map(envFlag)
  const missingRequired = inboxRequired.filter((item) => !item.set).map((item) => item.key)
  const missingRecommended = inboxRecommended.filter((item) => !item.set).map((item) => item.key)

  return {
    product: 'betsy-chat-crm-inbox' as const,
    graphApiVersion: (process.env.META_GRAPH_API_VERSION || META_CHAT_GRAPH_API_VERSION).trim(),
    instagramOAuthScopes: [...INSTAGRAM_OAUTH_SCOPES],
    whatsappOAuthScopes: [...WHATSAPP_OAUTH_SCOPES],
    urls: getMetaChatPublicUrls(origin),
    env: {
      inboxRequired,
      inboxRecommended,
      staffBot,
    },
    blockers: missingRequired,
    warnings: missingRecommended,
    notes: [
      'CRM inbox webhook is /api/chat/webhook. Do not point Meta inbox subscriptions at /api/bot/whatsapp/webhook.',
      'WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID / VERIFY_TOKEN belong to the staff AI bot, not tenant inboxes.',
      'Instagram requires a Professional Business account linked to a Facebook Page. Creator accounts cannot receive DMs via this API.',
      'Paste the NEXTAUTH_URL origin (www host) in Meta. Apex betsycrm.com 307s to www, which often breaks webhook GET verification.',
      'GET /api/chat/webhook can succeed using WHATSAPP_VERIFY_TOKEN as a fallback. Confirm META_WEBHOOK_VERIFY_TOKEN itself is set.',
    ],
  }
}
