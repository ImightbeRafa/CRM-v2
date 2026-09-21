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
  /** CRM Client row id — never reuse for optimistic send correlation. */
  clientId?: string
  orderId?: string
  messageType?: string
  providerMediaId?: string
  mediaMimeType?: string
  mediaFilename?: string
  mediaBlobPath?: string
  /** Provider/DB delivery tick: pending | sent | delivered | read | failed | … */
  deliveryStatus?: string | null
  /** Client-generated idempotency key for optimistic reconcile (metadata.clientRequestId). */
  clientRequestId?: string
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
        unreadCount: 0,
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

  return Object.values(grouped)
    .map((conv) => {
      let unread = 0
      for (let i = conv.messages.length - 1; i >= 0; i--) {
        if (conv.messages[i].direction === 'inbound') unread += 1
        else break
      }
      return { ...conv, unreadCount: unread }
    })
    .sort((a, b) => {
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

  // Meta WhatsApp customer-care window (CSW) / #131047 — outside 24h free-form replies.
  if (
    /#?131047\b/.test(message) ||
    /outside (of )?the (allowed )?messaging window/i.test(message) ||
    /more than 24 hours/i.test(message) ||
    /24[\s-]?hour(s)? (window|customer care)/i.test(message) ||
    /re-engagement message/i.test(message)
  ) {
    return 'La ventana de 24 horas ya cerró. El cliente debe escribir primero, o envía una plantilla aprobada por Meta.'
  }

  // Already Spanish-ish or Meta provider message — surface as-is
  return message
}

/** True when the send error means the social token must be reconnected. */
export function chatSendErrorNeedsReconnect(raw: string | undefined | null): boolean {
  const message = (raw || '').trim()
  if (!message) return false
  return (
    /reconect/i.test(message) ||
    /token (de .+ )?(expir|revoc)/i.test(message) ||
    /cuenta .+ desvinculad/i.test(message) ||
    /(#?190\b|#?102\b|#?463\b|#?467\b)/.test(message) ||
    /session has (been )?invalidated/i.test(message) ||
    /access token .+ (expired|invalid)/i.test(message) ||
    /oauth.?exception/i.test(message)
  )
}

/**
 * Desk delivery footer label (Respond.io-style).
 * Soft AI outbound keeps its own "IA envió" copy in the pane.
 */
export function outboundDeliveryLabel(
  status: string | null | undefined,
): 'Enviando…' | 'Enviado ✓' | 'Falló ✕' | 'Entregado' | 'Leído' {
  const s = (status || '').toLowerCase()
  if (s === 'failed' || s === 'error') return 'Falló ✕'
  if (s === 'pending' || s === 'sending' || s === 'queued') return 'Enviando…'
  if (s === 'delivered') return 'Entregado'
  if (s === 'read') return 'Leído'
  return 'Enviado ✓'
}

const DELIVERY_RANK: Record<string, number> = {
  pending: 1,
  sending: 1,
  queued: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 0,
  error: 0,
}

function deliveryRank(status: string | null | undefined): number {
  if (!status) return -1
  return DELIVERY_RANK[status.toLowerCase()] ?? 1
}

/** Prefer the more advanced monotonic delivery status (failed loses to sent). */
export function preferDeliveryStatus(
  a: string | null | undefined,
  b: string | null | undefined,
): string | null | undefined {
  if (a == null || a === '') return b
  if (b == null || b === '') return a
  const aFailed = /^(failed|error)$/i.test(a)
  const bFailed = /^(failed|error)$/i.test(b)
  if (aFailed && !bFailed) return b
  if (bFailed && !aFailed) return a
  return deliveryRank(b) >= deliveryRank(a) ? b : a
}

export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `crid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createOptimisticOutboundMessage(opts: {
  content: string
  clientRequestId: string
  to?: string
  platform?: string
  sentAt?: string
}): ChatInboxMessage {
  const sentAt = opts.sentAt || new Date().toISOString()
  const clientRequestId = opts.clientRequestId
  return {
    id: `optimistic:${clientRequestId}`,
    direction: 'outbound',
    content: opts.content,
    sentAt,
    receivedAt: null,
    deliveryStatus: 'pending',
    clientRequestId,
    metadata: {
      clientRequestId,
      optimistic: true,
      ...(opts.to ? { to: opts.to } : {}),
      ...(opts.platform ? { platform: opts.platform } : {}),
    },
  }
}

export function appendOptimisticOutbound(
  messages: ChatInboxMessage[],
  optimistic: ChatInboxMessage,
): ChatInboxMessage[] {
  const crid = optimistic.clientRequestId
  if (crid && messages.some((m) => m.clientRequestId === crid || m.id === optimistic.id)) {
    return messages
  }
  return [...messages, optimistic]
}

export function reconcileOptimisticOutbound(
  messages: ChatInboxMessage[],
  persisted: ChatInboxMessage,
): ChatInboxMessage[] {
  const crid =
    persisted.clientRequestId ||
    (typeof persisted.metadata?.clientRequestId === 'string'
      ? persisted.metadata.clientRequestId
      : undefined)
  let replaced = false
  const next = messages.map((m) => {
    const match =
      (crid && (m.clientRequestId === crid || m.id === `optimistic:${crid}`)) ||
      m.id === persisted.id
    if (!match) return m
    replaced = true
    return {
      ...persisted,
      clientRequestId: crid || persisted.clientRequestId || m.clientRequestId,
      deliveryStatus: preferDeliveryStatus(m.deliveryStatus, persisted.deliveryStatus) ?? 'sent',
    }
  })
  if (!replaced) {
    next.push({
      ...persisted,
      clientRequestId: crid || persisted.clientRequestId,
      deliveryStatus: persisted.deliveryStatus ?? 'sent',
    })
  }
  return next.sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id))
}

export function markOptimisticOutboundFailed(
  messages: ChatInboxMessage[],
  clientRequestId: string,
): ChatInboxMessage[] {
  return messages.map((m) => {
    if (m.clientRequestId === clientRequestId || m.id === `optimistic:${clientRequestId}`) {
      return { ...m, deliveryStatus: 'failed' }
    }
    return m
  })
}

/**
 * Merge thread windows by server id, then by clientRequestId.
 * Persisted rows win over optimistic; deliveryStatus prefers monotonic upgrade.
 */
export function mergeThreadMessagesPreferDelivery(
  existing: ChatInboxMessage[],
  incoming: ChatInboxMessage[],
): ChatInboxMessage[] {
  const byId = new Map<string, ChatInboxMessage>()
  const cridToId = new Map<string, string>()

  const upsert = (msg: ChatInboxMessage) => {
    const crid =
      msg.clientRequestId ||
      (typeof msg.metadata?.clientRequestId === 'string'
        ? msg.metadata.clientRequestId
        : undefined)
    const normalized: ChatInboxMessage = {
      ...msg,
      clientRequestId: crid || msg.clientRequestId,
    }

    if (crid && cridToId.has(crid)) {
      const prevId = cridToId.get(crid)!
      const prev = byId.get(prevId)
      if (prev) {
        const prevOptimistic = prev.id.startsWith('optimistic:')
        const nextOptimistic = normalized.id.startsWith('optimistic:')
        const winner = !nextOptimistic && prevOptimistic ? normalized : prevOptimistic && nextOptimistic ? normalized : {
          ...prev,
          ...normalized,
          id: nextOptimistic ? prev.id : normalized.id,
          deliveryStatus: preferDeliveryStatus(prev.deliveryStatus, normalized.deliveryStatus),
          clientRequestId: crid,
        }
        if (winner.id !== prevId) byId.delete(prevId)
        byId.set(winner.id, winner)
        cridToId.set(crid, winner.id)
        return
      }
    }

    const prev = byId.get(normalized.id)
    if (prev) {
      byId.set(normalized.id, {
        ...prev,
        ...normalized,
        deliveryStatus: preferDeliveryStatus(prev.deliveryStatus, normalized.deliveryStatus),
        clientRequestId: crid || prev.clientRequestId || normalized.clientRequestId,
      })
    } else {
      byId.set(normalized.id, normalized)
    }
    if (crid) cridToId.set(crid, normalized.id)
  }

  for (const m of existing) upsert(m)
  for (const m of incoming) upsert(m)

  return [...byId.values()].sort(
    (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id),
  )
}

/** Patch list-row preview fields after an optimistic outbound send. */
export function projectOptimisticListPreview<T extends {
  lastMessage?: string | null
  lastMessageAt?: string | null
  lastMessageDirection?: string | null
  unreadCount?: number
}>(row: T, content: string, sentAt: string): T {
  return {
    ...row,
    lastMessage: content.slice(0, 180),
    lastMessageAt: sentAt,
    lastMessageDirection: 'outbound',
  }
}
