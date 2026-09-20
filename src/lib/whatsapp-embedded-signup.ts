/**
 * WhatsApp Embedded Signup — coexistence (WhatsApp Business app onboarding).
 *
 * Meta docs (Onboard WhatsApp Business app users):
 * https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/
 *
 * Launch with extras.featureType = whatsapp_business_app_onboarding so store
 * owners can connect an existing WA Business *App* number (not only a new
 * Cloud API registration). Session completion uses
 * FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (often waba_id only).
 */

export const WA_EMBEDDED_SIGNUP_TYPE = 'WA_EMBEDDED_SIGNUP' as const

export const WA_COEXISTENCE_FEATURE_TYPE = 'whatsapp_business_app_onboarding' as const

/** Session logging version required by Meta for coexistence / session events. */
export const WA_SESSION_INFO_VERSION = '3' as const

export type WaEmbeddedSignupFinishEvent =
  | 'FINISH'
  | 'FINISH_ONLY_WABA'
  | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
  | 'FINISH_OBO_MIGRATION'
  | 'FINISH_GRANT_ONLY_API_ACCESS'

export type WaEmbeddedSignupSessionEvent =
  | WaEmbeddedSignupFinishEvent
  | 'CANCEL'
  | 'ERROR'
  | string

export type WaEmbeddedSignupSessionData = {
  phone_number_id?: string
  waba_id?: string
  whatsapp_business_account_id?: string
  [key: string]: unknown
}

export type WaEmbeddedSignupMessage = {
  type?: string
  event?: WaEmbeddedSignupSessionEvent
  version?: number | string
  data?: WaEmbeddedSignupSessionData
  phone_number_id?: string
  waba_id?: string
  whatsapp_business_account_id?: string
  [key: string]: unknown
}

export type WaFbLoginExtras = {
  setup: Record<string, never>
  featureType: typeof WA_COEXISTENCE_FEATURE_TYPE
  sessionInfoVersion: typeof WA_SESSION_INFO_VERSION
}

/** FB.login extras that enable coexistence (existing WA Business App numbers). */
export function buildWhatsAppCoexistenceLoginExtras(): WaFbLoginExtras {
  return {
    setup: {},
    featureType: WA_COEXISTENCE_FEATURE_TYPE,
    sessionInfoVersion: WA_SESSION_INFO_VERSION,
  }
}

export function buildWhatsAppEmbeddedSignupLoginOptions(configId: string): {
  config_id: string
  response_type: 'code'
  override_default_response_type: true
  auth_type: 'rerequest'
  return_scopes: true
  extras: WaFbLoginExtras
} {
  return {
    config_id: configId,
    response_type: 'code',
    override_default_response_type: true,
    auth_type: 'rerequest',
    return_scopes: true,
    extras: buildWhatsAppCoexistenceLoginExtras(),
  }
}

const FINISH_EVENTS = new Set<string>([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_OBO_MIGRATION',
  'FINISH_GRANT_ONLY_API_ACCESS',
])

export function isWaEmbeddedSignupMessage(value: unknown): value is WaEmbeddedSignupMessage {
  if (!value || typeof value !== 'object') return false
  return (value as WaEmbeddedSignupMessage).type === WA_EMBEDDED_SIGNUP_TYPE
}

export function isWaEmbeddedSignupFinishEvent(event: unknown): boolean {
  return typeof event === 'string' && FINISH_EVENTS.has(event)
}

export function isWaCoexistenceFinishEvent(event: unknown): boolean {
  return event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
}

export function extractWaEmbeddedSignupAssets(message: WaEmbeddedSignupMessage | null | undefined): {
  phoneNumberId: string | null
  wabaId: string | null
  event: string | null
  coexistence: boolean
} {
  if (!message) {
    return { phoneNumberId: null, wabaId: null, event: null, coexistence: false }
  }

  const data = message.data || {}
  const phoneNumberId =
    (typeof data.phone_number_id === 'string' && data.phone_number_id) ||
    (typeof message.phone_number_id === 'string' && message.phone_number_id) ||
    null
  const wabaId =
    (typeof data.waba_id === 'string' && data.waba_id) ||
    (typeof data.whatsapp_business_account_id === 'string' && data.whatsapp_business_account_id) ||
    (typeof message.waba_id === 'string' && message.waba_id) ||
    (typeof message.whatsapp_business_account_id === 'string' &&
      message.whatsapp_business_account_id) ||
    null
  const event = typeof message.event === 'string' ? message.event : null

  return {
    phoneNumberId: phoneNumberId ? String(phoneNumberId) : null,
    wabaId: wabaId ? String(wabaId) : null,
    event,
    coexistence: isWaCoexistenceFinishEvent(event),
  }
}

/**
 * Correlate FB.login authResponse with the WA_EMBEDDED_SIGNUP session postMessage.
 * Either may arrive first; exchange should run once when we have a token/code and
 * enough asset ids (phone and/or WABA for coexistence).
 */
export type WaSignupPendingParts = {
  code?: string | null
  accessToken?: string | null
  message?: WaEmbeddedSignupMessage | null
}

export function waSignupReadyToExchange(parts: WaSignupPendingParts): boolean {
  const hasCred = Boolean(parts.code || parts.accessToken)
  if (!hasCred) return false

  const assets = extractWaEmbeddedSignupAssets(parts.message || undefined)
  if (assets.phoneNumberId) return true
  // Coexistence FINISH often returns waba_id only — server resolves phone via Graph.
  if (assets.wabaId) return true
  return false
}

/**
 * Embedded Signup `code` is single-use. Never call Graph oauth/access_token until
 * the session has a phone_number_id or waba_id to finish the upsert.
 */
export function shouldDeferWhatsAppCodeExchange(parts: {
  code?: string | null
  accessToken?: string | null
  phoneNumberId?: string | null
  wabaId?: string | null
}): boolean {
  if (!parts.code) return false
  if (parts.accessToken) return false
  return !parts.phoneNumberId && !parts.wabaId
}

export function shouldIgnoreWaSessionEvent(event: unknown): boolean {
  if (event === 'CANCEL' || event === 'ERROR') return true
  if (typeof event === 'string' && event.startsWith('CANCEL')) return true
  return false
}

export const WA_DIRECT_OAUTH_MESSAGE_TYPE = 'wa_direct_oauth' as const

export type WaDirectOauthMessage = {
  type: typeof WA_DIRECT_OAUTH_MESSAGE_TYPE
  ok: boolean
  code: string
  error: string
}

/** Same-origin popup payload from `/api/auth/whatsapp/callback`. */
export function parseWaDirectOauthMessage(data: unknown): WaDirectOauthMessage | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const rec = data as Record<string, unknown>
  if (rec.type !== WA_DIRECT_OAUTH_MESSAGE_TYPE) return null
  return {
    type: WA_DIRECT_OAUTH_MESSAGE_TYPE,
    ok: rec.ok === true,
    code: typeof rec.code === 'string' ? rec.code : '',
    error: typeof rec.error === 'string' ? rec.error : '',
  }
}

function fbErrorCodeCandidates(error: unknown, depth = 0): unknown[] {
  if (error == null || depth > 3) return []
  if (typeof error === 'number' || typeof error === 'string') return [error]
  if (typeof error !== 'object') return []
  const rec = error as Record<string, unknown>
  return [
    rec.code,
    rec.error_code,
    rec.errorCode,
    rec.error_subcode,
    rec.message,
    rec.error_message,
    rec.error,
  ]
}

/** FB.login Embedded Signup fallback (SDK error 36008). */
export function isFbSdkEmbeddedSignup36008(error: unknown): boolean {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }]
  const seen = new Set<unknown>()
  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    const { value, depth } = item
    if (value == null || seen.has(value) || depth > 4) continue
    if (typeof value === 'object') seen.add(value)
    if (value === 36008 || value === '36008') return true
    if (typeof value === 'string' && /\b36008\b/.test(value)) return true
    if (typeof value === 'number' && value === 36008) return true
    for (const next of fbErrorCodeCandidates(value, depth)) {
      queue.push({ value: next, depth: depth + 1 })
    }
  }
  return false
}

export function buildWhatsAppDirectOauthDialogUrl(opts: {
  appId: string
  redirectUri: string
  state: string
  configId: string
  graphApiVersion?: string
}): string {
  const login = buildWhatsAppEmbeddedSignupLoginOptions(opts.configId)
  const version = (opts.graphApiVersion || 'v24.0').replace(/^\/+|\/+$/g, '')
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`)
  url.searchParams.set('client_id', opts.appId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('config_id', login.config_id)
  url.searchParams.set('response_type', login.response_type)
  url.searchParams.set('override_default_response_type', String(login.override_default_response_type))
  url.searchParams.set('auth_type', login.auth_type)
  url.searchParams.set('return_scopes', String(login.return_scopes))
  url.searchParams.set('extras', JSON.stringify(login.extras))
  return url.toString()
}
