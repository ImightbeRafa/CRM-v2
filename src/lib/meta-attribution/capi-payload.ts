/**
 * Conversions API for Business Messaging payload (pure; no token, no network).
 * WhatsApp: the click id (ctwa_clid) + the business's WhatsApp account id is all Meta needs —
 * no name, phone or email is ever sent (v1).
 */
export type PurchaseEventInput = {
  eventId: string
  eventTime: Date
  wabaId: string
  ctwaClid: string
  value: number
  currency: 'CRC' | 'USD'
}

export type CapiEvent = {
  event_name: 'Purchase'
  event_time: number
  event_id: string
  action_source: 'business_messaging'
  messaging_channel: 'whatsapp'
  user_data: { whatsapp_business_account_id: string; ctwa_clid: string }
  custom_data: { currency: 'CRC' | 'USD'; value: number }
}

export function purchaseEventId(orderId: string): string {
  return `betsy:order:${orderId}:Purchase`
}

export function buildPurchaseEvent(input: PurchaseEventInput): CapiEvent {
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
