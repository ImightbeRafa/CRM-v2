/**
 * Helpers for the /chats Meta inbox (Instagram + WhatsApp).
 * Pure functions so polling/merge/send error handling stay testable.
 */

export type ChatDirection = 'inbound' | 'outbound'

export interface ChatInboxMessage {
  id: string
  direction: ChatDirection | string
  content: string
  sentAt: string
  receivedAt: string | null
  metadata?: Record<string, unknown> | null
  clientId?: string
  orderId?: string
}

export interface ChatConversation {
  recipientId: string
  recipientName?: string
  lastMessage?: string
  lastMessageAt?: string
  unreadCount?: number
  messages: ChatInboxMessage[]
}

export const CHAT_POLL_INTERVAL_MS = 4000

/** Peer id for conversation grouping / reply recipient. */
export function getConversationPeerId(msg: {
  direction: string
  metadata?: Record<string, unknown> | null
}): string {
  const meta = msg.metadata || {}
  const from = typeof meta.from === 'string' ? meta.from : ''
  const to = typeof meta.to === 'string' ? meta.to : ''
  const waId = typeof meta.waId === 'string' ? meta.waId : ''

  if (msg.direction === 'inbound') {
    return from || waId || 'unknown'
  }
  if (msg.direction === 'outbound') {
    return to || 'unknown'
  }
  return from || to || waId || 'unknown'
}

function displayNameForPeer(
  msg: ChatInboxMessage,
  peerId: string,
  platformHint?: string,
): string {
  const meta = msg.metadata || {}
  const name = typeof meta.name === 'string' ? meta.name : ''
  const username = typeof meta.username === 'string' ? meta.username : ''
  let displayName = name || username || ''

  if (!displayName || displayName === peerId) {
    const platform =
      (typeof meta.platform === 'string' ? meta.platform : '') || platformHint || ''
    if (platform === 'instagram') {
      displayName = `IG User ${peerId.slice(-6)}`
    } else if (platform === 'whatsapp') {
      displayName = peerId.startsWith('+') ? peerId : `+${peerId}`
    } else {
      displayName = `User ${peerId.slice(-6)}`
    }
  }

  return displayName
}

/** Group flat inbox messages into conversations keyed by peer id. */
export function groupMessagesByRecipient(
  msgs: ChatInboxMessage[],
  platformHint?: string,
): ChatConversation[] {
  const grouped: Record<string, ChatConversation> = {}

  for (const msg of msgs) {
    const recipientId = getConversationPeerId(msg)
    const displayName = displayNameForPeer(msg, recipientId, platformHint)

    if (!grouped[recipientId]) {
      grouped[recipientId] = {
        recipientId,
        recipientName: displayName,
        messages: [],
        lastMessageAt: msg.sentAt || msg.receivedAt || undefined,
        lastMessage: msg.content.substring(0, 50) || '(mensaje vacío)',
      }
    } else {
      const meta = msg.metadata || {}
      if (typeof meta.name === 'string' && meta.name && meta.name !== recipientId) {
        grouped[recipientId].recipientName = meta.name
      }
    }

    grouped[recipientId].messages.push(msg)

    const currentLast = grouped[recipientId].lastMessageAt
    const thisTime = msg.sentAt || msg.receivedAt
    if (!currentLast || (thisTime && thisTime > currentLast)) {
      grouped[recipientId].lastMessageAt = thisTime || undefined
      grouped[recipientId].lastMessage = msg.content.substring(0, 50) || '(mensaje vacío)'
    }
  }

  return Object.values(grouped).sort((a, b) => {
    const aTime = a.lastMessageAt || '0'
    const bTime = b.lastMessageAt || '0'
    return bTime.localeCompare(aTime)
  })
}

/** Stable fingerprint so silent polls can skip setState when nothing changed. */
export function messagesFingerprint(msgs: ChatInboxMessage[]): string {
  return msgs.map((m) => `${m.id}:${m.direction}:${m.content.length}:${m.sentAt}`).join('|')
}

export type ParsedApiJsonResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; isHtml: boolean }

/**
 * Read a fetch Response as JSON without throwing on HTML error pages.
 * Used by /chats so send never alerts raw `Unexpected token '<'` SyntaxErrors.
 */
export async function parseApiJson<T = unknown>(res: Response): Promise<ParsedApiJsonResult<T>> {
  const text = await res.text()
  const trimmed = text.trim()

  if (!trimmed) {
    return {
      ok: false,
      error: res.ok
        ? 'Respuesta vacía del servidor'
        : `Error del servidor (${res.status})`,
      status: res.status,
      isHtml: false,
    }
  }

  try {
    return { ok: true, data: JSON.parse(trimmed) as T, status: res.status }
  } catch {
    const lower = trimmed.toLowerCase()
    const isHtml =
      trimmed.startsWith('<!') ||
      lower.startsWith('<html') ||
      lower.includes('<!doctype')

    return {
      ok: false,
      error: isHtml
        ? 'El servidor devolvió HTML en lugar de JSON (posible redirección de login, protección de deploy o error). Recarga la página e intenta de nuevo.'
        : 'Respuesta inválida del servidor',
      status: res.status,
      isHtml,
    }
  }
}

/** Prefer Spanish Meta/API error text for the inbox UI. */
export function humanizeChatSendError(raw: string | undefined | null, status?: number): string {
  const message = (raw || '').trim()
  if (!message) {
    if (status === 401) return 'Sesión expirada. Vuelve a iniciar sesión.'
    if (status === 403) return 'No tienes permiso para enviar mensajes.'
    if (status === 404) return 'Cuenta social no encontrada.'
    if (status && status >= 500) return 'Error al enviar el mensaje. Intenta de nuevo.'
    return 'No se pudo enviar el mensaje'
  }

  if (/unexpected token/i.test(message) || /<!doctype/i.test(message)) {
    return 'El servidor devolvió HTML en lugar de JSON. Recarga e intenta de nuevo.'
  }

  if (/unauthorized|authentication required/i.test(message)) {
    return 'Sesión expirada. Vuelve a iniciar sesión.'
  }

  if (/forbidden|insufficient permissions/i.test(message)) {
    return 'No tienes permiso para enviar mensajes.'
  }

  // Already Spanish-ish or Meta provider message — surface as-is
  return message
}
