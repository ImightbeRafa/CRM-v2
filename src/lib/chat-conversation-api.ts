import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { type SoftTag } from '@/lib/chat-soft-copilot'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import {
  channelLogoKey,
  channelSecondaryAddress,
  resolveChannelDisplayName,
  type SocialAccountIdentityFields,
} from '@/lib/social-account-identity'

export const CHAT_CONVERSATION_STATUS = z.enum(['nuevo', 'en_curso', 'hecho'])
export const CHAT_CONVERSATION_AI_MODE = z.enum(['ai_active', 'paused', 'human'])

export const patchConversationBodySchema = z
  .object({
    status: CHAT_CONVERSATION_STATUS.optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    assignedUserId: z.string().cuid().nullable().optional(),
    aiMode: CHAT_CONVERSATION_AI_MODE.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'No fields to update' })

export const importLocalStateBodySchema = z.object({
  items: z
    .array(
      z.object({
        conversationKey: z.string().min(3).max(256),
        status: CHAT_CONVERSATION_STATUS.optional(),
        tags: z.array(z.string()).max(20).optional(),
      }),
    )
    .max(500),
})

export type PatchConversationBody = z.infer<typeof patchConversationBodySchema>
export type ImportLocalStateBody = z.infer<typeof importLocalStateBodySchema>

export type SocialAccountChannelRow = {
  id: string
  platform: string
  accountId: string
  isActive: boolean
  displayName: string | null
  displayPhoneNumber: string | null
  providerDisplayName: string | null
  providerUsername: string | null
  phoneNumberId?: string | null
}

export type ConversationRow = {
  id: string
  tenantId: string
  socialAccountId: string
  peerId: string
  peerName: string | null
  peerAvatarUrl: string | null
  clientId: string | null
  status: string
  assignedUserId: string | null
  aiMode: string | null
  tags: string[]
  lastMessageId: string | null
  lastMessageAt: Date
  lastMessagePreview: string | null
  lastMessageDirection: string | null
  lastInboundAt: Date | null
  inboundCount: number
  revision: bigint
  assignedUser?: { id: string; name: string | null } | null
  socialAccount?: SocialAccountChannelRow | null
  readInboundCount?: number
}

export type ChatConversationListItemDto = {
  id: string
  socialAccountId: string
  peerId: string
  recipientId: string
  recipientName: string | null
  status: z.infer<typeof CHAT_CONVERSATION_STATUS>
  tags: string[]
  unreadCount: number
  revision: string
  lastMessageAt: string
  lastMessage: string | null
  lastMessageDirection: string | null
  waWindowOpen: boolean
  aiMode: SoftAiAgentMode | null
  assignedUserId: string | null
  assignedUser: { id: string; name: string | null } | null
  channel: {
    id: string
    platform: string
    displayName: string
    logoKey: 'whatsapp' | 'instagram'
    address: string | null
  }
  clientId: string | null
  agentLabel?: string | null
  agentEmoji?: string | null
  agentStateDot?: 'IA' | 'Sug' | 'Hum' | null
  pendingSuggestionText?: string | null
}

export type ChatMessageItemDto = {
  id: string
  direction: string
  content: string
  sentAt: string
  receivedAt: string | null
  deliveryStatus: string | null
  messageType: string | null
  clientId: string | null
  orderId: string | null
  metadata: Record<string, unknown> | null
  providerMediaId?: string | null
  mediaMimeType?: string | null
  mediaFilename?: string | null
  /** Prefer column when 026 lands; until then may live in metadata.mediaBlobPath. */
  mediaBlobPath?: string | null
  mediaCacheStatus?: string | null
}

const WA_WINDOW_MS = 24 * 60 * 60 * 1000

export function normalizeAiMode(value: string | null | undefined): SoftAiAgentMode | null {
  if (value === 'ai_active' || value === 'paused' || value === 'human') return value
  if (value === 'human_takeover') return 'human'
  return null
}

export function channelDisplayName(account: SocialAccountChannelRow): string {
  return resolveChannelDisplayName(account as SocialAccountIdentityFields)
}

export function channelAddress(account: SocialAccountChannelRow): string | null {
  return channelSecondaryAddress(account as SocialAccountIdentityFields)
}

export function waWindowOpenFromInbound(
  platform: string,
  lastInboundAt: Date | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (platform !== 'whatsapp') return true
  if (!lastInboundAt) return false
  return nowMs - lastInboundAt.getTime() < WA_WINDOW_MS
}

export function unreadCountForViewer(row: ConversationRow): number {
  const read = row.readInboundCount ?? 0
  return Math.max(0, row.inboundCount - read)
}

export function mapConversationToListDto(row: ConversationRow): ChatConversationListItemDto {
  const account = row.socialAccount
  const platform = account?.platform || 'whatsapp'
  const status = CHAT_CONVERSATION_STATUS.safeParse(row.status).success
    ? (row.status as z.infer<typeof CHAT_CONVERSATION_STATUS>)
    : 'nuevo'

  return {
    id: row.id,
    socialAccountId: row.socialAccountId,
    peerId: row.peerId,
    recipientId: row.peerId,
    recipientName: row.peerName,
    status,
    tags: row.tags,
    unreadCount: unreadCountForViewer(row),
    revision: row.revision.toString(),
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastMessage: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection,
    waWindowOpen: waWindowOpenFromInbound(platform, row.lastInboundAt),
    aiMode: normalizeAiMode(row.aiMode),
    assignedUserId: row.assignedUserId,
    assignedUser: row.assignedUser
      ? { id: row.assignedUser.id, name: row.assignedUser.name }
      : null,
    channel: account
      ? {
          id: account.id,
          platform: account.platform,
          displayName: channelDisplayName(account),
          logoKey: channelLogoKey(platform),
          address: channelAddress(account),
        }
      : {
          id: row.socialAccountId,
          platform,
          displayName: platform,
          logoKey: channelLogoKey(platform),
          address: null,
        },
    clientId: row.clientId,
  }
}

export function mapMessageToDto(message: {
  id: string
  direction: string
  content: string
  sentAt: Date
  receivedAt: Date | null
  deliveryStatus: string | null
  messageType: string | null
  clientId: string | null
  orderId: string | null
  metadata: unknown
  providerMediaId?: string | null
  mediaMimeType?: string | null
  mediaFilename?: string | null
  mediaBlobPath?: string | null
  mediaCacheStatus?: string | null
}): ChatMessageItemDto {
  const metadata =
    message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : null
  const mediaBlobPath =
    message.mediaBlobPath ??
    (typeof metadata?.mediaBlobPath === 'string' ? metadata.mediaBlobPath : null)
  const mediaCacheStatus =
    message.mediaCacheStatus ??
    (typeof metadata?.mediaCacheStatus === 'string' ? metadata.mediaCacheStatus : null)
  return {
    id: message.id,
    direction: message.direction,
    content: message.content,
    sentAt: message.sentAt.toISOString(),
    receivedAt: message.receivedAt ? message.receivedAt.toISOString() : null,
    deliveryStatus: message.deliveryStatus,
    messageType: message.messageType,
    clientId: message.clientId,
    orderId: message.orderId,
    metadata,
    providerMediaId: message.providerMediaId ?? null,
    mediaMimeType: message.mediaMimeType ?? null,
    mediaFilename: message.mediaFilename ?? null,
    mediaBlobPath,
    mediaCacheStatus,
  }
}

export function parseConversationKey(conversationKey: string): { socialAccountId: string; peerId: string } | null {
  const idx = conversationKey.indexOf('::')
  if (idx <= 0 || idx >= conversationKey.length - 2) return null
  return {
    socialAccountId: conversationKey.slice(0, idx),
    peerId: conversationKey.slice(idx + 2),
  }
}

export function coerceSoftTags(tags: string[] | undefined): SoftTag[] {
  if (!tags?.length) return []
  const allowed = new Set<SoftTag>(['Envío', 'VIP', 'Nuevo'])
  return tags.filter((t): t is SoftTag => allowed.has(t as SoftTag))
}

export function conversationSelect(): Prisma.ChatConversationSelect {
  return {
    id: true,
    tenantId: true,
    socialAccountId: true,
    peerId: true,
    peerName: true,
    peerAvatarUrl: true,
    clientId: true,
    status: true,
    assignedUserId: true,
    aiMode: true,
    tags: true,
    lastMessageId: true,
    lastMessageAt: true,
    lastMessagePreview: true,
    lastMessageDirection: true,
    lastInboundAt: true,
    inboundCount: true,
    revision: true,
    assignedUser: { select: { id: true, name: true } },
    socialAccount: {
      select: {
        id: true,
        platform: true,
        accountId: true,
        isActive: true,
        displayName: true,
        displayPhoneNumber: true,
        providerDisplayName: true,
        providerUsername: true,
      },
    },
  }
}
