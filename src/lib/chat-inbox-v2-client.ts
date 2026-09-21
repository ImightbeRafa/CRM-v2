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
export const CHAT_INBOX_V2_POLL_MS = 4000
export const CHAT_INBOX_V2_FULL_RECONCILE_MS = 120_000
export const CHAT_INBOX_V2_LIST_PAGE_LIMIT = 50
export const CHAT_INBOX_V2_LIST_MAX_PAGES = 40

export function messageDtoToInbox(row: ChatMessageItemDto): ChatInboxMessage {
  return {
    id: row.id,
    direction: row.direction,
    content: row.content,
    sentAt: row.sentAt,
    receivedAt: row.receivedAt,
    metadata: row.metadata,
    clientId: row.clientId ?? undefined,
    orderId: row.orderId ?? undefined,
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
