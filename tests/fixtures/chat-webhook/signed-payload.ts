/**
 * Minimal signed Meta webhook fixture helper for chat Phase 4 replay / burst.
 *
 * Does not hit production. Used by scripts/chat-webhook-burst.ts and unit tests.
 */
import crypto from 'node:crypto'

export const CHAT_WEBHOOK_FIXTURE_SECRET = 'chat-scale-fixture-secret'

export type SignedWebhookFixture = {
  rawBody: string
  signatureHeader: string
  accountId: string
  providerMessageId: string
  peerId: string
  platform: 'whatsapp' | 'instagram'
}

export function signMetaWebhookBody(
  rawBody: string,
  secret: string = CHAT_WEBHOOK_FIXTURE_SECRET,
): string {
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return `sha256=${digest}`
}

export function buildWhatsAppTextWebhook(args: {
  phoneNumberId: string
  peerWaId: string
  providerMessageId: string
  text: string
  timestampSec?: number
}): { object: string; entry: unknown[] } {
  const ts = String(args.timestampSec ?? Math.floor(Date.now() / 1000))
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-scale-fixture',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '50600000000',
                phone_number_id: args.phoneNumberId,
              },
              contacts: [{ profile: { name: 'Scale Peer' }, wa_id: args.peerWaId }],
              messages: [
                {
                  from: args.peerWaId,
                  id: args.providerMessageId,
                  timestamp: ts,
                  type: 'text',
                  text: { body: args.text },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

export function buildSignedWhatsAppFixture(args: {
  accountIndex: number
  eventIndex: number
  secret?: string
}): SignedWebhookFixture {
  const phoneNumberId = `scale_phone_${String(args.accountIndex + 1).padStart(4, '0')}`
  const providerMessageId = `wamid.burst.${args.accountIndex}.${args.eventIndex}`
  const peerId = `5068${String(args.accountIndex).padStart(2, '0')}${String(args.eventIndex).padStart(6, '0')}`
  const payload = buildWhatsAppTextWebhook({
    phoneNumberId,
    peerWaId: peerId,
    providerMessageId,
    text: `burst ${args.accountIndex}:${args.eventIndex}`,
  })
  const rawBody = JSON.stringify(payload)
  return {
    rawBody,
    signatureHeader: signMetaWebhookBody(rawBody, args.secret ?? CHAT_WEBHOOK_FIXTURE_SECRET),
    accountId: phoneNumberId,
    providerMessageId,
    peerId,
    platform: 'whatsapp',
  }
}
