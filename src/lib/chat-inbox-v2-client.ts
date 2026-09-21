import type { ChatInboxMessage } from '@/lib/chat-inbox'
import {
  conversationStorageKey,
  type ConversationStatus,
  type SoftConversation,
  type SoftTag,
} from '@/lib/chat-soft-copilot'
import type { ChatConversationListItemDto, ChatMessageItemDto } from '@/lib/chat-conversation-api'
import { coerceSoftTags } from '@/lib/chat-conversation-api'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'

export const CHAT_INBOX_V2_IMPORTED_KEY = 'betsy.softCopilot.inboxV2Imported.v1'
export const CHAT_INBOX_V2_POLL_MS = 5000
export const CHAT_INBOX_V2_FULL_RECONCILE_MS = 120_000
export const CHAT_INBOX_V2_LIST_PAGE_LIMIT = 50
export const CHAT_INBOX_V2_LIST_MAX_PAGES = 40
export const CHAT_INBOX_V2_THREAD_FETCH_LIMIT = 50
/** First-paint / DOM window — Phase 4 acceptance 4.3: ≤100 nodes. */
export const CHAT_INBOX_V2_THREAD_RENDER_WINDOW = 100
/** In-memory store cap (older pages + window); DOM still clipped to RENDER_WINDOW. */
export const CHAT_INBOX_V2_THREAD_STORE_CAP = 300

export function messageDtoToInbox(row: ChatMessageItemDto): ChatInboxMessage {
  const meta = row.metadata
  const providerMediaId =
    row.providerMediaId ??
    (typeof meta?.providerMediaId === 'string' ? meta.providerMediaId : undefined)
  const mediaMimeType =
    row.mediaMimeType ??
    (typeof meta?.mediaMimeType === 'string' ? meta.mediaMimeType : undefined)
  const mediaFilename =
    row.mediaFilename ??
    (typeof meta?.mediaFilename === 'string' ? meta.mediaFilename : undefined)
  const mediaBlobPath =
    row.mediaBlobPath ??
    (typeof meta?.mediaBlobPath === 'string' ? meta.mediaBlobPath : undefined)
  return {
    id: row.id,
    direction: row.direction,
    content: row.content,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    metadata: row.metadata,
    clientId: row.clientId ?? undefined,
    orderId: row.orderId ?? undefined,
    messageType: row.messageType ?? undefined,
    providerMediaId: providerMediaId || undefined,
    mediaMimeType: mediaMimeType || undefined,
    mediaFilename: mediaFilename || undefined,
    mediaBlobPath: mediaBlobPath || undefined,
  }
}

export function listDtoToSoftConversation(
  dto: ChatConversationListItemDto,
  messages: ChatInboxMessage[],
): SoftConversation {
  const orderId =
    [...messages].reverse().find((m) => m.orderId)?.orderId ?? null
  return {
    recipientId: dto.peerId,
    recipientName: dto.recipientName ?? undefined,
    lastMessage: dto.lastMessage ?? undefined,
    lastMessageAt: dto.lastMessageAt,
    unreadCount: dto.unreadCount,
    messages,
    socialAccountId: dto.socialAccountId,
    platform: dto.channel.platform,
    accountLabel: dto.channel.displayName,
    channelAddress: dto.channel.address ?? null,
    status: dto.status as ConversationStatus,
    tags: coerceSoftTags(dto.tags),
    orderId,
  }
}

export function softConversationKeyFromDto(dto: ChatConversationListItemDto): string {
  return conversationStorageKey(dto.socialAccountId, dto.peerId)
}

export function mergeListDtoIntoMap(
  prev: Map<string, ChatConversationListItemDto>,
  items: ChatConversationListItemDto[],
): Map<string, ChatConversationListItemDto> {
  const next = new Map(prev)
  for (const item of items) {
    next.set(item.id, item)
  }
  return next
}

export function sortedConversationDtos(map: Map<string, ChatConversationListItemDto>): ChatConversationListItemDto[] {
  return [...map.values()].sort((a, b) => {
    const byTime = b.lastMessageAt.localeCompare(a.lastMessageAt)
    if (byTime !== 0) return byTime
    return b.id.localeCompare(a.id)
  })
}

export function aiModeFromDto(dto: ChatConversationListItemDto): SoftAiAgentMode | null {
  return dto.aiMode
}

export function buildLocalImportPayload(
  statusMap: Record<string, ConversationStatus>,
  tagsMap: Record<string, SoftTag[]>,
): { conversationKey: string; status?: ConversationStatus; tags?: SoftTag[] }[] {
  const keys = new Set([...Object.keys(statusMap), ...Object.keys(tagsMap)])
  const items: { conversationKey: string; status?: ConversationStatus; tags?: SoftTag[] }[] = []
  for (const conversationKey of keys) {
    const status = statusMap[conversationKey]
    const tags = tagsMap[conversationKey]
    if (!status && (!tags || !tags.length)) continue
    items.push({
      conversationKey,
      ...(status ? { status } : {}),
      ...(tags?.length ? { tags } : {}),
    })
  }
  return items
}

export type ChatInboxV2ListPage<T extends { id: string }> = {
  conversations: T[]
  nextCursor?: string | null
  maxRevision?: string | null
}

export type ChatInboxV2ListWalkStopReason = 'complete' | 'repeated_cursor' | 'max_pages'

export type ChatInboxV2ListWalk<T extends { id: string }> = {
  items: T[]
  maxRevision: string | null
  complete: boolean
  stopReason: ChatInboxV2ListWalkStopReason
}

export async function walkConversationListPages<T extends { id: string }>(opts: {
  fetchPage: (cursor: string | null) => Promise<ChatInboxV2ListPage<T>>
  maxPages?: number
}): Promise<ChatInboxV2ListWalk<T>> {
  const maxPages = opts.maxPages ?? CHAT_INBOX_V2_LIST_MAX_PAGES
  const byId = new Map<string, T>()
  const seenCursors = new Set<string>()
  let cursor: string | null = null
  let maxRevision: string | null = null
  let pages = 0

  while (pages < maxPages) {
    if (cursor) {
      if (seenCursors.has(cursor)) {
        return {
          items: [...byId.values()],
          maxRevision: null,
          complete: false,
          stopReason: 'repeated_cursor',
        }
      }
      seenCursors.add(cursor)
    }

    const page = await opts.fetchPage(cursor)
    pages += 1
    for (const item of page.conversations) {
      byId.set(item.id, item)
    }
    if (page.maxRevision) maxRevision = page.maxRevision

    const next = page.nextCursor?.trim() || null
    if (!next) {
      return {
        items: [...byId.values()],
        maxRevision,
        complete: true,
        stopReason: 'complete',
      }
    }
    cursor = next
  }

  return {
    items: [...byId.values()],
    maxRevision: null,
    complete: false,
    stopReason: 'max_pages',
  }
}

export function buildChatTemplateSendBody(opts: {
  socialAccountId: string
  recipient: string
  template: { name: string; language: string }
}): {
  socialAccountId: string
  recipient: string
  type: 'template'
  templateName: string
  templateLanguage: string
  content: string
} {
  return {
    socialAccountId: opts.socialAccountId,
    recipient: opts.recipient,
    type: 'template',
    templateName: opts.template.name,
    templateLanguage: opts.template.language,
    content: `[Plantilla] ${opts.template.name}`,
  }
}

/** Advance revision cursor only to the last delivered change — never jump to tenant head. */
export function advanceRevisionCursor(opts: {
  current: bigint
  nextRevision?: string | null
  /** @deprecated tenant-head max — ignored for cursor advancement */
  maxRevision?: string | null
  hasMoreChanges?: boolean
}): { next: bigint; continueDrain: boolean } {
  const raw = (opts.nextRevision ?? '').trim()
  if (!raw || !/^\d+$/.test(raw)) {
    return { next: opts.current, continueDrain: false }
  }
  const delivered = BigInt(raw)
  const next = delivered > opts.current ? delivered : opts.current
  return {
    next,
    continueDrain: Boolean(opts.hasMoreChanges),
  }
}

export type ChatInboxV2PollDecision =
  | { action: 'skip'; reason: 'hidden' | 'in_flight' }
  | { action: 'changes' }
  | { action: 'reconcile' }

export function decideInboxV2PollTick(opts: {
  documentHidden: boolean
  inFlight: boolean
  nowMs: number
  lastFullReconcileMs: number
  fullReconcileEveryMs?: number
}): ChatInboxV2PollDecision {
  if (opts.documentHidden) return { action: 'skip', reason: 'hidden' }
  if (opts.inFlight) return { action: 'skip', reason: 'in_flight' }
  const every = opts.fullReconcileEveryMs ?? CHAT_INBOX_V2_FULL_RECONCILE_MS
  if (opts.nowMs - opts.lastFullReconcileMs >= every) {
    return { action: 'reconcile' }
  }
  return { action: 'changes' }
}

/** Keep newest `max` messages for DOM render (oldest dropped from the window). */
export function selectThreadRenderWindow<T extends { id: string; sentAt: string }>(
  messages: T[],
  max = CHAT_INBOX_V2_THREAD_RENDER_WINDOW,
): T[] {
  if (messages.length <= max) return messages
  return messages.slice(messages.length - max)
}

/**
 * Merge thread pages and cap store size.
 * When over cap after loading older, drop from the newest end so older history stays;
 * otherwise (tail merge) keep the newest and drop oldest.
 */
export function mergeThreadMessageWindow<T extends { id: string; sentAt: string }>(opts: {
  existing: T[]
  incoming: T[]
  mode: 'replace' | 'tail' | 'older'
  storeCap?: number
}): T[] {
  const cap = opts.storeCap ?? CHAT_INBOX_V2_THREAD_STORE_CAP
  if (opts.mode === 'replace') {
    const sorted = [...opts.incoming].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
    return sorted.length > cap ? sorted.slice(sorted.length - cap) : sorted
  }

  const byId = new Map(opts.existing.map((m) => [m.id, m]))
  for (const m of opts.incoming) byId.set(m.id, m)
  const sorted = [...byId.values()].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  if (sorted.length <= cap) return sorted

  if (opts.mode === 'older') {
    // Prefer keeping newly loaded older pages + mid history; drop newest overflow.
    return sorted.slice(0, cap)
  }
  // Tail / default: keep newest.
  return sorted.slice(sorted.length - cap)
}

export function buildChangesPollQuery(opts: {
  afterRevision: string
  limit?: number
  threadId?: string | null
  threadAfter?: string | null
  includeReconcilePage?: boolean
}): string {
  const qs = new URLSearchParams({
    afterRevision: opts.afterRevision,
    limit: String(opts.limit ?? 200),
  })
  if (opts.threadId) {
    qs.set('threadId', opts.threadId)
    if (opts.threadAfter) qs.set('threadAfter', opts.threadAfter)
  }
  if (opts.includeReconcilePage) qs.set('reconcilePage', '1')
  return qs.toString()
}
