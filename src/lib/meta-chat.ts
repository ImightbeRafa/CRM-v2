export type MetaChatPlatform = 'instagram' | 'whatsapp'

export type MetaChatMessageDirection = 'inbound' | 'outbound'

export interface ParsedMetaChatMessage {
  platform: MetaChatPlatform
  accountId: string
  senderId: string
  senderName?: string
  content: string
  providerMessageId?: string
  messageType: string
  sentAt: Date
  /** inbound = customer → business; outbound = business → customer (incl. SMB echoes). */
  direction: MetaChatMessageDirection
  /** When true, webhook must not run Soft Tenant AI. */
  suppressSoftAi: boolean
  metadata: Record<string, unknown>
}

export type MetaChatReceiptStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface ParsedMetaChatReceipt {
  platform: MetaChatPlatform
  accountId: string
  providerMessageId?: string
  peerId?: string
  status: MetaChatReceiptStatus
  statusAt: Date
  errorCode?: string
  kind: 'whatsapp_status' | 'instagram_delivery' | 'instagram_read'
}

export interface ParsedMetaChatPayload {
  messages: ParsedMetaChatMessage[]
  ignoredReasons: string[]
  receipts: ParsedMetaChatReceipt[]
  /** Soft signals from account_update (e.g. PARTNER_REMOVED). */
  accountEvents?: Array<{
    wabaId: string
    phoneNumber: string | null
    event: string
    reason?: string
    initiatedBy?: string
  }>
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
  const receipts: ParsedMetaChatReceipt[] = []
  const accountEvents: NonNullable<ParsedMetaChatPayload['accountEvents']> = []

  for (const entry of payload?.entry || []) {
    const wabaId = entry?.id ? String(entry.id) : ''

    for (const change of entry?.changes || []) {
      const field = change?.field ? String(change.field) : 'messages'
      const value = change?.value

      if (!value) {
        ignoredReasons.push('whatsapp_missing_value')
        continue
      }

      if (field === 'account_update') {
        const eventName = value?.event ? String(value.event) : ''
        if (eventName) {
          accountEvents.push({
            wabaId,
            phoneNumber: value?.phone_number ? String(value.phone_number) : null,
            event: eventName,
            reason: value?.disconnection_info?.reason
              ? String(value.disconnection_info.reason)
              : undefined,
            initiatedBy: value?.disconnection_info?.initiated_by
              ? String(value.disconnection_info.initiated_by)
              : undefined,
          })
        } else {
          ignoredReasons.push('whatsapp_account_update_no_event')
        }
        continue
      }

      if (field === 'smb_app_state_sync') {
        // Contact sync — no chat message to store; ack for Meta.
        ignoredReasons.push('whatsapp_smb_app_state_sync')
        continue
      }

      const phoneNumberId = value?.metadata?.phone_number_id
        ? String(value.metadata.phone_number_id)
        : null

      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          if (!phoneNumberId || !status?.id || !status?.status) {
            ignoredReasons.push('whatsapp_status_incomplete')
            continue
          }
          const mapped = String(status.status)
          if (!['sent', 'delivered', 'read', 'failed'].includes(mapped)) {
            ignoredReasons.push(`whatsapp_status_unmapped:${mapped}`)
            continue
          }
          const recipientId = status.recipient_id ? String(status.recipient_id) : undefined
          const errorCode =
            status.errors?.[0]?.code != null ? String(status.errors[0].code) : undefined
          receipts.push({
            platform: 'whatsapp',
            accountId: phoneNumberId,
            providerMessageId: String(status.id),
            peerId: recipientId,
            status: mapped as MetaChatReceiptStatus,
            statusAt: toDateFromMetaTimestamp(status.timestamp),
            errorCode,
            kind: 'whatsapp_status',
          })
        }
      }

      // Decline-to-share history error (Meta code 2593109) or approved history threads.
      if (field === 'history' && Array.isArray(value.history)) {
        for (const hist of value.history) {
          if (hist?.errors?.length) {
            ignoredReasons.push('whatsapp_history_not_shared')
            continue
          }
          for (const thread of hist?.threads || []) {
            const threadId = thread?.id ? String(thread.id) : ''
            for (const message of thread?.messages || []) {
              if (!phoneNumberId || !message) {
                ignoredReasons.push('whatsapp_history_missing_account_or_message')
                continue
              }
              const from = message.from ? String(message.from) : ''
              const to = message.to ? String(message.to) : ''
              // Thread id is the WhatsApp user. Business-sent history rows include `to`
              // (SMB echo shape) or have from !== thread customer id.
              const finalDirection: MetaChatMessageDirection =
                from === threadId ? 'inbound' : 'outbound'
              const peerId =
                finalDirection === 'inbound' ? from || threadId : to || threadId || from
              const content = getWhatsAppContent(message)
              if (!peerId) {
                ignoredReasons.push('whatsapp_history_missing_peer')
                continue
              }
              messages.push({
                platform: 'whatsapp',
                accountId: phoneNumberId,
                senderId: peerId,
                senderName: peerId ? `+${peerId}` : undefined,
                content,
                providerMessageId: message.id ? String(message.id) : undefined,
                messageType: message.type || 'unknown',
                sentAt: toDateFromMetaTimestamp(message.timestamp),
                direction: finalDirection,
                suppressSoftAi: true,
                metadata: compactObject({
                  providerMessageId: message.id,
                  providerTimestamp: message.timestamp,
                  messageType: message.type || 'unknown',
                  displayPhoneNumber: value.metadata?.display_phone_number,
                  whatsappBusinessAccountId: wabaId || undefined,
                  webhookField: 'history',
                  historyPhase: hist?.metadata?.phase,
                  historyChunk: hist?.metadata?.chunk_order,
                  historical: true,
                  rawMessage: message,
                }),
              })
            }
          }
        }
        continue
      }

      if (field === 'smb_message_echoes') {
        for (const message of value.message_echoes || value.messages || []) {
          if (!phoneNumberId || !message?.to) {
            ignoredReasons.push('whatsapp_echo_missing_account_or_to')
            continue
          }
          const content = getWhatsAppContent(message)
          messages.push({
            platform: 'whatsapp',
            accountId: phoneNumberId,
            senderId: String(message.to),
            senderName: message.to ? `+${message.to}` : undefined,
            content,
            providerMessageId: message.id ? String(message.id) : undefined,
            messageType: message.type || 'unknown',
            sentAt: toDateFromMetaTimestamp(message.timestamp),
            direction: 'outbound',
            suppressSoftAi: true,
            metadata: compactObject({
              providerMessageId: message.id,
              providerTimestamp: message.timestamp,
              messageType: message.type || 'unknown',
              displayPhoneNumber: value.metadata?.display_phone_number,
              whatsappBusinessAccountId: wabaId || undefined,
              webhookField: 'smb_message_echoes',
              smbEcho: true,
              rawMessage: message,
            }),
          })
        }
        continue
      }

      // Default: live Cloud API messages field
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
          direction: 'inbound',
          suppressSoftAi: false,
          metadata: compactObject({
            providerMessageId: message.id,
            providerTimestamp: message.timestamp,
            messageType: message.type || 'unknown',
            displayPhoneNumber: value.metadata?.display_phone_number,
            whatsappBusinessAccountId: wabaId || undefined,
            webhookField: field,
            waId: contact?.wa_id,
            rawMessage: message,
          }),
        })
      }
    }
  }

  return {
    messages,
    ignoredReasons,
    receipts,
    accountEvents: accountEvents.length ? accountEvents : undefined,
  }
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

/**
 * Instagram Business Account ids from Meta commonly start with 178414.
 * Page webhooks use Facebook Page ids on entry.id; recipient.id may be the IG id.
 */
export function looksLikeInstagramBusinessId(id: string): boolean {
  return /^178414\d+$/.test(id.trim())
}

type InstagramMessagingSource = 'instagram' | 'page'

function resolveInstagramAccountId(params: {
  source: InstagramMessagingSource
  entryId: string
  recipientId: string
}): string {
  const { source, entryId, recipientId } = params
  if (source === 'page' && recipientId && looksLikeInstagramBusinessId(recipientId)) {
    return recipientId
  }
  return entryId
}

function parseInstagramMessaging(
  payload: any,
  source: InstagramMessagingSource,
): ParsedMetaChatPayload {
  const messages: ParsedMetaChatMessage[] = []
  const ignoredReasons: string[] = []
  const receipts: ParsedMetaChatReceipt[] = []

  for (const entry of payload?.entry || []) {
    const entryId = entry?.id ? String(entry.id) : ''

    for (const event of entry?.messaging || []) {
      if (event?.read) {
        const senderId = event?.sender?.id ? String(event.sender.id) : ''
        const recipientId = event?.recipient?.id ? String(event.recipient.id) : ''
        if (!entryId || !senderId) {
          ignoredReasons.push('instagram_read_incomplete')
          continue
        }
        const accountId = resolveInstagramAccountId({ source, entryId, recipientId })
        const watermark = event.read?.watermark
        const mid = event.read?.mid || event.read?.message_id
        receipts.push({
          platform: 'instagram',
          accountId,
          providerMessageId: mid ? String(mid) : undefined,
          peerId: senderId,
          status: 'read',
          statusAt: watermark
            ? toDateFromMetaTimestamp(watermark)
            : toDateFromMetaTimestamp(event.timestamp),
          kind: 'instagram_read',
        })
        continue
      }

      if (event?.delivery) {
        const senderId = event?.sender?.id ? String(event.sender.id) : ''
        const recipientId = event?.recipient?.id ? String(event.recipient.id) : ''
        if (!entryId || !senderId) {
          ignoredReasons.push('instagram_delivery_incomplete')
          continue
        }
        const accountId = resolveInstagramAccountId({ source, entryId, recipientId })
        const mids = Array.isArray(event.delivery?.mids)
          ? event.delivery.mids
          : event.delivery?.mid
            ? [event.delivery.mid]
            : []
        const statusAt = event.delivery?.watermark
          ? toDateFromMetaTimestamp(event.delivery.watermark)
          : toDateFromMetaTimestamp(event.timestamp)
        if (mids.length === 0) {
          receipts.push({
            platform: 'instagram',
            accountId,
            peerId: senderId,
            status: 'delivered',
            statusAt,
            kind: 'instagram_delivery',
          })
        } else {
          for (const mid of mids) {
            receipts.push({
              platform: 'instagram',
              accountId,
              providerMessageId: String(mid),
              peerId: senderId,
              status: 'delivered',
              statusAt,
              kind: 'instagram_delivery',
            })
          }
        }
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

      const senderId = event?.sender?.id
      if (!entryId || !senderId) {
        ignoredReasons.push('instagram_missing_account_or_sender')
        continue
      }

      const recipientId = event?.recipient?.id ? String(event.recipient.id) : ''
      const accountId = resolveInstagramAccountId({ source, entryId, recipientId })
      const messageType = message.attachments?.[0]?.type || (message.text ? 'text' : 'unknown')
      const isEcho = Boolean(message.is_echo)

      // Echo = business-sent from IG app / inbox; store as outbound, never Soft-AI.
      const peerId = isEcho ? recipientId : String(senderId)
      if (!peerId) {
        ignoredReasons.push('instagram_echo_missing_peer')
        continue
      }

      messages.push({
        platform: 'instagram',
        accountId,
        senderId: peerId,
        senderName: isEcho
          ? undefined
          : `Instagram User ${String(senderId).slice(-6)}`,
        content: getInstagramContent(message),
        providerMessageId: message.mid ? String(message.mid) : undefined,
        messageType,
        sentAt: toDateFromMetaTimestamp(event.timestamp),
        direction: isEcho ? 'outbound' : 'inbound',
        suppressSoftAi: isEcho,
        metadata: compactObject({
          providerMessageId: message.mid,
          providerTimestamp: event.timestamp,
          messageType,
          instagramAccountId:
            source === 'instagram'
              ? accountId
              : looksLikeInstagramBusinessId(accountId)
                ? accountId
                : undefined,
          recipientId: recipientId || undefined,
          webhookObject: source === 'page' ? 'page' : undefined,
          pageId: source === 'page' ? entryId : undefined,
          isEcho: isEcho || undefined,
          rawMessage: message,
        }),
      })
    }
  }

  return { messages, ignoredReasons, receipts }
}

function pagePayloadHasMessaging(payload: any): boolean {
  return (payload?.entry || []).some(
    (entry: any) => Array.isArray(entry?.messaging) && entry.messaging.length > 0,
  )
}

export function parseMetaChatPayload(payload: any): ParsedMetaChatPayload {
  if (payload?.object === 'whatsapp_business_account') {
    return parseWhatsApp(payload)
  }

  if (payload?.object === 'instagram') {
    return parseInstagramMessaging(payload, 'instagram')
  }

  if (payload?.object === 'page') {
    if (!pagePayloadHasMessaging(payload)) {
      return {
        messages: [],
        ignoredReasons: ['page_without_messaging'],
        receipts: [],
      }
    }
    return parseInstagramMessaging(payload, 'page')
  }

  return {
    messages: [],
    ignoredReasons: payload?.object ? [`unsupported_object:${payload.object}`] : ['missing_object'],
    receipts: [],
  }
}
