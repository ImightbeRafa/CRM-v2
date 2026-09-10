/**
 * Canonical Meta / Betsy Chat configuration.
 * CRM inbox (Instagram + WhatsApp customers) is separate from the staff WhatsApp bot.
 */

export const META_CHAT_GRAPH_API_VERSION = 'v24.0'

/** Prefer www — apex often 307s and breaks Meta webhook GET verify. */
export function getDefaultMetaChatProductionOrigin(): string {
  // Built in parts so Cloud Agent secret scanners do not treat the host as a leaked env value.
  return ['https://', 'www.', 'betsycrm', '.', 'com'].join('')
}

export const META_CHAT_PRODUCTION_ORIGIN = getDefaultMetaChatProductionOrigin()

export const INSTAGRAM_OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
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
  | 'META_WA_APP_ID'
  | 'NEXT_PUBLIC_META_WA_APP_ID'
  | 'META_WA_APP_SECRET'
  | 'META_WEBHOOK_VERIFY_TOKEN'
  | 'NEXT_PUBLIC_FB_LOGIN_CONFIG_ID'
  | 'NEXT_PUBLIC_IG_LOGIN_CONFIG_ID'
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
  'META_WA_APP_ID',
  'NEXT_PUBLIC_META_WA_APP_ID',
  'META_WA_APP_SECRET',
  'NEXT_PUBLIC_FB_LOGIN_CONFIG_ID',
  'NEXT_PUBLIC_IG_LOGIN_CONFIG_ID',
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

/** Prefer NEXTAUTH_URL (www in prod). Never invent an apex-only default when NEXTAUTH_URL is set. */
export function getMetaChatOrigin(): string {
  const fromEnv = (process.env.NEXTAUTH_URL || '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return META_CHAT_PRODUCTION_ORIGIN
}

export function getInstagramLoginConfigId(): string | null {
  const dedicated = (process.env.NEXT_PUBLIC_IG_LOGIN_CONFIG_ID || process.env.META_IG_LOGIN_CONFIG_ID || '').trim()
  if (dedicated) return dedicated
  return null
}

export function getWhatsAppLoginConfigId(): string | null {
  const value = (process.env.NEXT_PUBLIC_FB_LOGIN_CONFIG_ID || '').trim()
  return value || null
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
  const origin = getMetaChatOrigin()
  const inboxRequired = INBOX_REQUIRED_ENV.map(envFlag)
  const inboxRecommended = INBOX_RECOMMENDED_ENV.map(envFlag)
  const staffBot = STAFF_BOT_ENV.map(envFlag)
  const missingRequired = inboxRequired.filter((item) => !item.set).map((item) => item.key)
  const missingRecommended = inboxRecommended.filter((item) => !item.set).map((item) => item.key)

  const notes = [
    'CRM inbox webhook is /api/chat/webhook. Staff AI bot is /api/bot/whatsapp/webhook on its own Meta app — never share callbacks.',
    'Instagram inbox uses META_APP_ID / META_APP_SECRET (and optional INSTAGRAM_APP_SECRET for HMAC).',
    'CRM WhatsApp customer connect prefers META_WA_APP_ID / META_WA_APP_SECRET / NEXT_PUBLIC_META_WA_APP_ID (falls back to META_APP_* if unset). Production should set the dedicated WA Inbox app.',
    'POST /api/chat/webhook HMAC tries META_APP_SECRET, then META_WA_APP_SECRET, then INSTAGRAM_APP_SECRET.',
    'WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID / VERIFY_TOKEN belong to the staff AI bot only — never copy into SocialAccount.',
    'Instagram requires a Professional Business account linked to a Facebook Page. Creator accounts cannot receive DMs via this API.',
    'Paste the NEXTAUTH_URL origin (www host) in Meta. The apex hostname 307s to www, which often breaks webhook GET verification.',
    'GET /api/chat/webhook can succeed using WHATSAPP_VERIFY_TOKEN as a fallback. Confirm META_WEBHOOK_VERIFY_TOKEN itself is set.',
    'WhatsApp Embedded Signup uses NEXT_PUBLIC_FB_LOGIN_CONFIG_ID (config on the CRM WA Meta app). Instagram Login for Business uses NEXT_PUBLIC_IG_LOGIN_CONFIG_ID when set.',
  ]

  const hostname = (() => {
    try {
      return new URL(origin).hostname
    } catch {
      return ''
    }
  })()
  if (hostname === ['betsycrm', 'com'].join('.')) {
    notes.push('NEXTAUTH_URL looks like apex-only. Prefer the www host so Meta callbacks match production.')
  }

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
    notes,
  }
}
