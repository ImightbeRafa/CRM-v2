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
  if (assets.wabaId && (assets.coexistence || assets.event === 'FINISH_ONLY_WABA')) return true
  // Classic FINISH without ids yet — keep waiting for session payload.
  if (parts.message && isWaEmbeddedSignupFinishEvent(assets.event) && !assets.phoneNumberId && !assets.wabaId) {
    return false
  }
  // Token alone (no session yet): allow a soft exchange that returns waitingForPhoneNumber.
  // Callers that want strict correlation should require message.
  return !parts.message
}

export function shouldIgnoreWaSessionEvent(event: unknown): boolean {
  if (event === 'CANCEL' || event === 'ERROR') return true
  if (typeof event === 'string' && event.startsWith('CANCEL')) return true
  return false
}
