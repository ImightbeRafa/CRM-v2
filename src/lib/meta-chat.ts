export type MetaChatPlatform = 'instagram' | 'whatsapp'

export interface ParsedMetaChatMessage {
  platform: MetaChatPlatform
  accountId: string
  senderId: string
  senderName?: string
  content: string
  providerMessageId?: string
  messageType: string
  sentAt: Date
  metadata: Record<string, unknown>
}

export interface ParsedMetaChatPayload {
  messages: ParsedMetaChatMessage[]
  ignoredReasons: string[]
}

function toDateFromMetaTimestamp(timestamp: unknown): Date {
  const numeric = Number(timestamp)
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date()

  // WhatsApp sends seconds; Instagram/Messenger sends milliseconds.
  return new Date(String(Math.trunc(numeric)).length > 10 ? numeric : numeric * 1000)
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== '')) as T
}

function getWhatsAppContent(message: any): string {
  switch (message?.type) {
    case 'text':
      return message.text?.body || ''
    case 'button':
      return message.button?.text || message.button?.payload || ''
    case 'interactive':
      return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        message.interactive?.button_reply?.id ||
        message.interactive?.list_reply?.id ||
        ''
      )
    case 'image':
      return message.image?.caption || '[image]'
    case 'video':
      return message.video?.caption || '[video]'
    case 'audio':
      return '[audio]'
    case 'voice':
      return '[voice]'
    case 'document':
      return message.document?.caption || message.document?.filename || '[document]'
    case 'location':
      return message.location?.name || message.location?.address || '[location]'
    case 'contacts':
      return '[contact]'
    case 'sticker':
      return '[sticker]'
    default:
      return message?.type ? `[${message.type}]` : ''
  }
}

function parseWhatsApp(payload: any): ParsedMetaChatPayload {
  const messages: ParsedMetaChatMessage[] = []
  const ignoredReasons: string[] = []

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value
      const phoneNumberId = value?.metadata?.phone_number_id

      if (!value) {
        ignoredReasons.push('whatsapp_missing_value')
        continue
      }

      if (value.statuses?.length) {
        ignoredReasons.push('whatsapp_status_update')
      }

      for (const message of value.messages || []) {
        if (!phoneNumberId || !message?.from) {
          ignoredReasons.push('whatsapp_missing_account_or_sender')
          continue
        }

        const contact = (value.contacts || []).find((item: any) => item?.wa_id === message.from) || value.contacts?.[0]
        const content = getWhatsAppContent(message)

        messages.push({
          platform: 'whatsapp',
          accountId: String(phoneNumberId),
          senderId: String(message.from),
          senderName: contact?.profile?.name || (message.from ? `+${message.from}` : undefined),
          content,
          providerMessageId: message.id ? String(message.id) : undefined,
          messageType: message.type || 'unknown',
          sentAt: toDateFromMetaTimestamp(message.timestamp),
          metadata: compactObject({
            providerMessageId: message.id,
            providerTimestamp: message.timestamp,
            messageType: message.type || 'unknown',
            displayPhoneNumber: value.metadata?.display_phone_number,
            whatsappBusinessAccountId: entry?.id,
            waId: contact?.wa_id,
            rawMessage: message,
          }),
        })
      }
    }
  }

  return { messages, ignoredReasons }
}

function getInstagramContent(message: any): string {
  if (message?.text) return String(message.text)
  if (message?.quick_reply?.payload) return String(message.quick_reply.payload)
  if (message?.attachments?.length) {
    const type = message.attachments[0]?.type
    return type ? `[${type}]` : '[attachment]'
  }
  return ''
}

function parseInstagram(payload: any): ParsedMetaChatPayload {
  const messages: ParsedMetaChatMessage[] = []
  const ignoredReasons: string[] = []

  for (const entry of payload?.entry || []) {
    const igAccountId = entry?.id

    for (const event of entry?.messaging || []) {
      if (event?.read) {
        ignoredReasons.push('instagram_read_event')
        continue
      }

      if (event?.delivery) {
        ignoredReasons.push('instagram_delivery_event')
        continue
      }

      if (event?.reaction) {
        ignoredReasons.push('instagram_reaction_event')
        continue
      }

      const message = event?.message
      if (!message) {
        ignoredReasons.push('instagram_non_message_event')
        continue
      }

      if (message.is_echo) {
        ignoredReasons.push('instagram_echo_event')
        continue
      }

      const senderId = event?.sender?.id
      if (!igAccountId || !senderId) {
        ignoredReasons.push('instagram_missing_account_or_sender')
        continue
      }

      messages.push({
        platform: 'instagram',
        accountId: String(igAccountId),
        senderId: String(senderId),
        senderName: senderId ? `Instagram User ${String(senderId).slice(-6)}` : undefined,
        content: getInstagramContent(message),
        providerMessageId: message.mid ? String(message.mid) : undefined,
        messageType: message.attachments?.[0]?.type || (message.text ? 'text' : 'unknown'),
        sentAt: toDateFromMetaTimestamp(event.timestamp),
        metadata: compactObject({
          providerMessageId: message.mid,
          providerTimestamp: event.timestamp,
          messageType: message.attachments?.[0]?.type || (message.text ? 'text' : 'unknown'),
          instagramAccountId: igAccountId,
          rawMessage: message,
        }),
      })
    }
  }

  return { messages, ignoredReasons }
}

export function parseMetaChatPayload(payload: any): ParsedMetaChatPayload {
  if (payload?.object === 'whatsapp_business_account') {
    return parseWhatsApp(payload)
  }

  if (payload?.object === 'instagram') {
    return parseInstagram(payload)
  }

  return {
    messages: [],
    ignoredReasons: payload?.object ? [`unsupported_object:${payload.object}`] : ['missing_object'],
  }
}
