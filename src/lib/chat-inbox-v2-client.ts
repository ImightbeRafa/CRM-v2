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
