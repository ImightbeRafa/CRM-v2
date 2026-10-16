/**
 * agents2-pace: WhatsApp Cloud API "escribiendo…" indicator before a paced reply message. It also marks the
 * customer's message as read (Meta sends both in one call). Best effort: never throws, gives up after
 * TYPING_INDICATOR_TIMEOUT_MS, WhatsApp only (Instagram gets the waits without an indicator).
 */
import 'server-only'

import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { TYPING_INDICATOR_TIMEOUT_MS } from '@/lib/soft-ai/reply-pace'

/** Meta's message ids (wamid.…): anything else is not sent to the API. */
const WAMID_RE = /^wamid\.[A-Za-z0-9+/=_-]{8,300}$/

export async function sendWhatsappTypingIndicator(opts: {
  accessToken: string
  phoneNumberId: string | null | undefined
  inboundMessageId: string | null | undefined
}): Promise<boolean> {
  try {
    if (!opts.phoneNumberId || !opts.inboundMessageId || !WAMID_RE.test(opts.inboundMessageId)) return false
    const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${opts.phoneNumberId}/messages`), opts.accessToken, { purpose: 'whatsapp' })
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: opts.inboundMessageId,
        typing_indicator: { type: 'text' },
      }),
      signal: AbortSignal.timeout(TYPING_INDICATOR_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}
