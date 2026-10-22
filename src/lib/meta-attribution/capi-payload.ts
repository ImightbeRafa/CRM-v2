/**
 * Conversions API for Business Messaging payload (pure; no token, no network).
 * WhatsApp: the click id (ctwa_clid) + the business's WhatsApp account id is all Meta needs.
 * Instagram (no click id on IG): the business's Instagram account id + the customer's Instagram-scoped
 * id (IGSID, the conversation peer from the messages webhook). No name, phone or email is ever sent.
 * Meta doc: developers.facebook.com/docs/marketing-api/conversions-api/business-messaging.
 */
export type PurchaseEventInput = {
  eventId: string
  eventTime: Date
  wabaId: string
  ctwaClid: string
  value: number
  currency: 'CRC' | 'USD'
}

export type InstagramPurchaseEventInput = {
  eventId: string
  eventTime: Date
  /** The business's Instagram professional account id (= the IG user id the dataset hangs from). */
  igAccountId: string
  /** The customer's Instagram-scoped id (ChatConversation.peerId). */
  igsid: string
  value: number
  currency: 'CRC' | 'USD'
}

type CapiEventBase = {
  event_name: 'Purchase'
  event_time: number
  event_id: string
  action_source: 'business_messaging'
  custom_data: { currency: 'CRC' | 'USD'; value: number }
}

export type WhatsAppCapiEvent = CapiEventBase & {
  messaging_channel: 'whatsapp'
  user_data: { whatsapp_business_account_id: string; ctwa_clid: string }
}

export type InstagramCapiEvent = CapiEventBase & {
  messaging_channel: 'instagram'
  user_data: { instagram_business_account_id: string; ig_sid: string }
}

export type CapiEvent = WhatsAppCapiEvent | InstagramCapiEvent

/** Meta ids are numeric strings; anything else is never sent. */
export const META_NUMERIC_ID = /^\d{5,30}$/

export function purchaseEventId(orderId: string): string {
  return `betsy:order:${orderId}:Purchase`
}

export function buildPurchaseEvent(input: PurchaseEventInput): WhatsAppCapiEvent {
  return {
    event_name: 'Purchase',
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    user_data: { whatsapp_business_account_id: input.wabaId, ctwa_clid: input.ctwaClid },
    custom_data: { currency: input.currency, value: input.value },
  }
}

export function buildInstagramPurchaseEvent(input: InstagramPurchaseEventInput): InstagramCapiEvent {
  if (!META_NUMERIC_ID.test(input.igAccountId) || !META_NUMERIC_ID.test(input.igsid)) throw new Error('BAD_INSTAGRAM_ID')
  return {
    event_name: 'Purchase',
    event_time: Math.floor(input.eventTime.getTime() / 1000),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'instagram',
    user_data: { instagram_business_account_id: input.igAccountId, ig_sid: input.igsid },
    custom_data: { currency: input.currency, value: input.value },
  }
}

export function buildEventsBody(events: CapiEvent[], testEventCode: string | null): Record<string, unknown> {
  return {
    data: events,
    partner_agent: 'betsycrm',
    ...(testEventCode ? { test_event_code: testEventCode } : {}),
  }
}

/** Meta error code → what to do with the event / the line. */
export type CapiErrorAction = 'token_invalid' | 'missing_permission' | 'retry' | 'failed'

export function classifyCapiError(status: number, code: number | null): CapiErrorAction {
  if (status === 0) return 'retry' // network error / timeout
  if (code === 190) return 'token_invalid'
  if (code === 10 || code === 200 || code === 294 || (code !== null && code >= 200 && code <= 299)) return 'missing_permission'
  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80004 || code === 2 || status === 429 || status >= 500) return 'retry'
  return 'failed'
}

export const MAX_SEND_ATTEMPTS = 6

/** Backoff 2^attempts minutes (2, 4, 8 … 64). */
export function retryDelayMs(attempts: number): number {
  return Math.min(2 ** Math.max(1, attempts), 64) * 60_000
}
