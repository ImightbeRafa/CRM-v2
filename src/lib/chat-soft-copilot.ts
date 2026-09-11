/**
 * Soft Copilot UI helpers for /chats — stubs and presentation only.
 * No staff-bot AI; summaries/suggestions are heuristics from last messages.
 */

import type { ChatConversation, ChatInboxMessage } from '@/lib/chat-inbox'

export type ConversationStatus = 'nuevo' | 'en_curso' | 'hecho'
export type ChannelFilter = 'todos' | 'whatsapp' | 'instagram'
export type InboxBucket = 'tus_chats' | 'abiertos' | 'sin_asignar' | 'ia_manejando' | 'hechos'
export type SoftTag = 'Envío' | 'VIP' | 'Nuevo'

export const SOFT_COPILOT_STATUS_KEY = 'betsy.softCopilot.conversationStatus.v1'
export const SOFT_COPILOT_TAGS_KEY = 'betsy.softCopilot.conversationTags.v1'

export interface SoftConversation extends ChatConversation {
  socialAccountId: string
  platform: 'whatsapp' | 'instagram' | string
  accountLabel: string
  status: ConversationStatus
  tags: SoftTag[]
  orderId?: string | null
  /** Local Soft demo seed only — never persisted to ChatMessage. */
  isDemo?: boolean
}

export interface SoftSocialAccount {
  id: string
  platform: string
  accountId: string
  isActive: boolean
  phoneNumberId?: string | null
  whatsappBusinessAccountId?: string | null
  pageId?: string | null
}

/** Short display label for a connected social account. */
export function accountDisplayLabel(account: SoftSocialAccount): string {
  if (account.platform === 'whatsapp') {
    const id = account.phoneNumberId || account.accountId
    if (id.length > 10) return `WA · …${id.slice(-6)}`
    return `WA · ${id}`
  }
  const handle = account.accountId.startsWith('@') ? account.accountId : `@${account.accountId}`
  if (handle.length > 18) return `IG · ${handle.slice(0, 16)}…`
  return `IG · ${handle}`
}

export function platformShort(platform: string): 'WA' | 'IG' | string {
  if (platform === 'whatsapp') return 'WA'
  if (platform === 'instagram') return 'IG'
  return platform
}

export function initialsFromName(name: string | undefined | null): string {
  const raw = (name || '?').trim()
  if (!raw) return '?'
  const cleaned = raw.replace(/^@/, '')
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
  }
  return cleaned.slice(0, 2).toUpperCase()
}

/** Relative Spanish-ish time for list rows. */
export function formatRelativeEs(iso: string | undefined | null, nowMs = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffSec = Math.max(0, Math.floor((nowMs - t) / 1000))
  if (diffSec < 60) return `${Math.max(1, diffSec)}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'Ayer'
  if (diffD < 7) return `${diffD}d`
  return new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })
}

/** Count consecutive trailing inbound messages after last outbound. */
export function computeUnreadCount(messages: ChatInboxMessage[]): number {
  let count = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].direction === 'inbound') count += 1
    else break
  }
  return count
}

const ORDER_RE = /\b(ORDER[-_\s]?[A-Z0-9]+|ORD[-_\s]?\d+|pedido\s*#?\s*\d+)\b/i
const TRACKING_RE = /\b(gu[ií]a|tracking|rastreo|n[uú]mero de gu[ií]a)\b/i
const PRICE_RE = /\b(precio|cu[aá]nto|costo|kit)\b/i

/** Heuristic yellow Resumen IA block — stub, not a product AI. */
export function buildAiSummary(
  conversation: Pick<SoftConversation, 'messages' | 'recipientName' | 'accountLabel' | 'platform'>,
): string {
  const msgs = conversation.messages
  if (!msgs.length) return 'Sin mensajes aún. Esperá el primer mensaje del cliente.'

  const lastInbound = [...msgs].reverse().find((m) => m.direction === 'inbound')
  const lastOutbound = [...msgs].reverse().find((m) => m.direction === 'outbound')
  const blob = msgs
    .slice(-6)
    .map((m) => m.content)
    .join(' ')

  const orderMatch = blob.match(ORDER_RE)
  const orderBit = orderMatch ? orderMatch[1].replace(/\s+/g, '-').toUpperCase() : null
  const name = conversation.recipientName || 'Cliente'
  const account = conversation.accountLabel

  if (TRACKING_RE.test(blob) || /gu[ií]a/i.test(lastInbound?.content || '')) {
    const orderPart = orderBit ? ` de ${orderBit}` : ''
    const next = lastOutbound
      ? 'Siguiente: confirmar o enviar tracking.'
      : 'Siguiente: responder con estado del envío.'
    return `Cliente pide guía${orderPart} (${account}). ${next}`
  }

  if (PRICE_RE.test(lastInbound?.content || '') || PRICE_RE.test(blob)) {
    return `${name} pregunta por precio/kit (${account}). Siguiente: cotizar o mandar link.`
  }

  const snippet = (lastInbound?.content || msgs[msgs.length - 1]?.content || '').slice(0, 80)
  return `${name} · último: “${snippet}${snippet.length >= 80 ? '…' : ''}”. Canal: ${platformShort(conversation.platform)} · ${account}.`
}

/** Stub suggested reply in Spanish CR. */
export function buildSuggestedReply(
  conversation: Pick<SoftConversation, 'messages' | 'recipientName' | 'platform'>,
): { title: string; draft: string } {
  const name = (conversation.recipientName || 'hola').split(/\s+/)[0] || 'hola'
  const firstName = name.replace(/^@/, '')
  const lastInbound = [...conversation.messages].reverse().find((m) => m.direction === 'inbound')
  const text = lastInbound?.content || ''

  if (TRACKING_RE.test(text) || /gu[ií]a/i.test(text)) {
    return {
      title: '¿Qué responder sobre la guía?',
      draft: `Claro ${firstName}, te paso el número de guía en cuanto Correos lo publique (1–2h). ¿Te aviso por acá?`,
    }
  }

  if (PRICE_RE.test(text)) {
    return {
      title: '¿Qué responder sobre el precio?',
      draft: `¡Con gusto ${firstName}! Te paso el precio del kit y las opciones de envío. ¿Es para San José o interior?`,
    }
  }

  if (/pedido|sali[oó]|despach/i.test(text)) {
    return {
      title: '¿Qué responder sobre el pedido?',
      draft: `Hola ${firstName}, ya reviso tu pedido y te confirmo el estado en unos minutos. ¡Gracias por la paciencia!`,
    }
  }

  return {
    title: 'Sugerencia de respuesta',
    draft: `Hola ${firstName}, gracias por escribirnos. ¿En qué te puedo ayudar hoy?`,
  }
}

const WA_WINDOW_MS = 24 * 60 * 60 * 1000

/** True when WhatsApp free-form window is still open (last inbound < 24h). */
export function isWhatsAppWindowOpen(
  messages: ChatInboxMessage[],
  platform: string,
  nowMs = Date.now(),
): boolean {
  if (platform !== 'whatsapp') return true
  const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound')
  if (!lastInbound) return false
  const t = new Date(lastInbound.receivedAt || lastInbound.sentAt).getTime()
  if (Number.isNaN(t)) return false
  return nowMs - t < WA_WINDOW_MS
}

export function isWhatsAppWindowClosedError(message: string | null | undefined): boolean {
  if (!message) return false
  return (
    /ventana de 24/i.test(message) ||
    /#?131047\b/.test(message) ||
    /plantilla aprobada/i.test(message)
  )
}

export function defaultStatusForConversation(messages: ChatInboxMessage[]): ConversationStatus {
  if (!messages.length) return 'nuevo'
  const last = messages[messages.length - 1]
  if (last.direction === 'inbound') return 'nuevo'
  return 'en_curso'
}

export function defaultTagsForConversation(messages: ChatInboxMessage[]): SoftTag[] {
  const blob = messages
    .slice(-8)
    .map((m) => m.content)
    .join(' ')
  const tags: SoftTag[] = []
  if (TRACKING_RE.test(blob) || ORDER_RE.test(blob) || /env[ií]o|despach/i.test(blob)) {
    tags.push('Envío')
  }
  if (messages.length <= 2) tags.push('Nuevo')
  return tags.length ? tags : ['Nuevo']
}

export function conversationStorageKey(
  socialAccountId: string,
  recipientId: string,
): string {
  return `${socialAccountId}::${recipientId}`
}

export function readStatusMap(): Record<string, ConversationStatus> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SOFT_COPILOT_STATUS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ConversationStatus>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeStatusMap(map: Record<string, ConversationStatus>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOFT_COPILOT_STATUS_KEY, JSON.stringify(map))
  } catch {
    // ignore quota
  }
}

export function readTagsMap(): Record<string, SoftTag[]> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(SOFT_COPILOT_TAGS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, SoftTag[]>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeTagsMap(map: Record<string, SoftTag[]>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOFT_COPILOT_TAGS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function enrichConversations(opts: {
  messages: ChatInboxMessage[]
  socialAccountId: string
  platform: string
  accountLabel: string
  statusMap: Record<string, ConversationStatus>
  tagsMap: Record<string, SoftTag[]>
  groupFn: (msgs: ChatInboxMessage[], platformHint?: string) => ChatConversation[]
}): SoftConversation[] {
  const grouped = opts.groupFn(opts.messages, opts.platform)
  return grouped.map((c) => {
    const key = conversationStorageKey(opts.socialAccountId, c.recipientId)
    const unread = computeUnreadCount(c.messages)
    const orderId =
      [...c.messages].reverse().find((m) => m.orderId)?.orderId || null
    return {
      ...c,
      socialAccountId: opts.socialAccountId,
      platform: opts.platform,
      accountLabel: opts.accountLabel,
      unreadCount: unread,
      status: opts.statusMap[key] || defaultStatusForConversation(c.messages),
      tags: opts.tagsMap[key] || defaultTagsForConversation(c.messages),
      orderId,
    }
  })
}

export function filterSoftConversations(
  conversations: SoftConversation[],
  opts: {
    bucket: InboxBucket
    channel: ChannelFilter
    accountId: string | 'all'
    search: string
  },
): SoftConversation[] {
  const q = opts.search.trim().toLowerCase()
  return conversations.filter((c) => {
    if (opts.channel === 'whatsapp' && c.platform !== 'whatsapp') return false
    if (opts.channel === 'instagram' && c.platform !== 'instagram') return false
    if (opts.accountId !== 'all' && c.socialAccountId !== opts.accountId) return false
    if (opts.bucket === 'hechos' && c.status !== 'hecho') return false
    if (opts.bucket === 'abiertos' && c.status === 'hecho') return false
    if (opts.bucket === 'tus_chats' && c.status === 'hecho') return false
    // Sin asignar chrome: treat as open/new without inventing staffing product
    if (opts.bucket === 'sin_asignar' && c.status !== 'nuevo') return false
    // IA manejando filtered by SoftCopilotInbox via agentMode map (status still open)
    if (opts.bucket === 'ia_manejando' && c.status === 'hecho') return false
    if (!q) return true
    const hay = `${c.recipientName || ''} ${c.lastMessage || ''} ${c.accountLabel} ${c.recipientId}`.toLowerCase()
    return hay.includes(q)
  })
}

export function stubSources(conversation: SoftConversation | null): Array<{ label: string; href?: string }> {
  if (!conversation) {
    return [
      { label: 'Política de envíos' },
      { label: 'Plantilla guía Correos' },
    ]
  }
  const blob = conversation.messages.map((m) => m.content).join(' ')
  const orderMatch = blob.match(ORDER_RE)
  const sources: Array<{ label: string; href?: string }> = [
    { label: 'Política de envíos' },
    { label: 'Plantilla guía Correos' },
  ]
  if (orderMatch) {
    sources.push({ label: `${orderMatch[1].toUpperCase()} en Betsy`, href: '/ventas' })
  } else if (conversation.orderId) {
    sources.push({ label: `Pedido en Betsy`, href: '/ventas' })
  } else {
    sources.push({ label: 'Pedidos en Betsy', href: '/ventas' })
  }
  return sources
}

export type AgentChecklistItem = {
  id: string
  label: string
  state: 'done' | 'progress' | 'todo'
}

/** Monitor queue stats for Soft inbox (replaces suggest-first checklist). */
export type SoftAiMonitorStats = {
  aiActive: number
  paused: number
  human: number
  toolActions: number
}

export function buildAgentChecklist(opts: {
  hasConversation: boolean
  hasSummary: boolean
  hasDraft: boolean
  windowOpen: boolean
}): AgentChecklistItem[] {
  return [
    {
      id: 'channel',
      label: 'Canal identificado',
      state: opts.hasConversation ? 'done' : 'todo',
    },
    {
      id: 'monitor',
      label: 'Monitor IA listo',
      state: opts.hasSummary ? 'done' : opts.hasConversation ? 'progress' : 'todo',
    },
    {
      id: 'tools',
      label: 'Herramientas',
      state: opts.hasDraft ? 'done' : opts.hasConversation ? 'progress' : 'todo',
    },
    {
      id: 'control',
      label: opts.windowOpen ? 'Tomar / Pausar / Reanudar' : 'Elegir plantilla',
      state: 'todo',
    },
  ]
}
