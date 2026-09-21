/**
 * Transactional dual-write for ChatConversation + ChatMessage (Respond.io PR-2).
 * Keeps legacy metadata JSON so flag-off clients continue to work.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  compareMessageOrder,
  deriveConversationPeer,
  toMessageDate,
  truncatePreview,
} from '@/lib/chat-conversation-foundation'
import { normalizeClientPhone } from '@/lib/order-lifecycle'

export const DELIVERY_STATUS_RANK = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  received: 0,
} as const

export type DeliveryStatus = keyof typeof DELIVERY_STATUS_RANK

export type DualWriteDirection = 'inbound' | 'outbound'

export interface DualWriteMessageInput {
  tenantId: string
  socialAccountId: string
  direction: DualWriteDirection
  content: string
  sentAt: Date
  receivedAt?: Date | null
  peerId?: string | null
  peerName?: string | null
  providerMessageId?: string | null
  messageType?: string | null
  deliveryStatus?: DeliveryStatus | null
  platform?: string | null
  metadata?: Record<string, unknown>
  clientId?: string | null
  orderId?: string | null
  /** When true, Soft AI must not run (echoes / history). */
  suppressSoftAi?: boolean
  providerMediaId?: string | null
  mediaMimeType?: string | null
  mediaFilename?: string | null
}

export type DualWriteResult =
  | {
      ok: true
      duplicate: false
      messageId: string
      conversationId: string
      tenantId: string
      socialAccountId: string
      peerId: string
      direction: DualWriteDirection
      content: string
      peerName: string | null
      suppressSoftAi: boolean
    }
  | {
      ok: true
      duplicate: true
      messageId: string | null
      conversationId: string | null
      reason: 'duplicate'
    }
  | {
      ok: false
      reason: 'missing_peer' | 'literal_unknown' | 'error'
      error?: string
    }

/** True when dual-write persisted or reconciled to a concrete row (including echo-first). */
export function isPersistedDualWrite(
  write: DualWriteResult,
): write is Extract<DualWriteResult, { ok: true }> & {
  messageId: string
  conversationId: string
} {
  return write.ok === true && Boolean(write.messageId && write.conversationId)
}

export function shouldReplaceConversationPreview(
  current: { lastMessageAt: Date | null; lastMessageId: string | null },
  incoming: { sentAt: Date; messageId: string },
): boolean {
  if (!current.lastMessageAt) return true
  return (
    compareMessageOrder(
      { sentAt: current.lastMessageAt, id: current.lastMessageId || '' },
      { sentAt: incoming.sentAt, id: incoming.messageId },
    ) < 0
  )
}

export function shouldAdvanceConversationTimestamp(
  current: Date | null,
  incoming: Date,
): boolean {
  if (!current) return true
  return toMessageDate(incoming).getTime() > toMessageDate(current).getTime()
}

function isP2002(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  )
}

export function isDeliveryStatusMonotonicUpgrade(
  current: string | null | undefined,
  next: DeliveryStatus,
): boolean {
  if (!current) return true
  if (current === next) return false
  if (current === 'read') return false
  if (
    current === 'failed' &&
    (next === 'delivered' || next === 'read' || next === 'sent')
  ) {
    return false
  }
  const curRank = DELIVERY_STATUS_RANK[current as DeliveryStatus]
  const nextRank = DELIVERY_STATUS_RANK[next]
  if (curRank === undefined) return true
  if (next === 'failed') return curRank < DELIVERY_STATUS_RANK.delivered
  return nextRank > curRank
}

async function findClientIdForWhatsAppPeer(
  tx: Prisma.TransactionClient,
  tenantId: string,
  peerId: string,
  platform: string | null | undefined,
): Promise<string | null> {
  if (platform && platform !== 'whatsapp') return null
  const normalized = normalizeClientPhone(peerId)
  if (!normalized) return null
  const client = await tx.client.findFirst({
    where: { tenantId, normalizedPhone: normalized },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  return client?.id ?? null
}

async function ensureConversation(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    socialAccountId: string
    peerId: string
    peerName: string | null
    platform?: string | null
    sentAt: Date
  },
): Promise<{ id: string; clientId: string | null; peerName: string | null }> {
  const existing = await tx.chatConversation.findUnique({
    where: {
      tenantId_socialAccountId_peerId: {
        tenantId: args.tenantId,
        socialAccountId: args.socialAccountId,
        peerId: args.peerId,
      },
    },
    select: { id: true, clientId: true, peerName: true },
  })
  if (existing) return existing

  const clientId = await findClientIdForWhatsAppPeer(
    tx,
    args.tenantId,
    args.peerId,
    args.platform,
  )

  try {
    const created = await tx.chatConversation.create({
      data: {
        tenantId: args.tenantId,
        socialAccountId: args.socialAccountId,
        peerId: args.peerId,
        peerName: args.peerName,
        clientId: clientId ?? undefined,
        status: 'nuevo',
        tags: [],
        lastMessageAt: args.sentAt,
        inboundCount: 0,
        messageCount: 0,
      },
      select: { id: true, clientId: true, peerName: true },
    })
    return created
  } catch (error) {
    if (!isP2002(error)) throw error
    const raced = await tx.chatConversation.findUnique({
      where: {
        tenantId_socialAccountId_peerId: {
          tenantId: args.tenantId,
          socialAccountId: args.socialAccountId,
          peerId: args.peerId,
        },
      },
      select: { id: true, clientId: true, peerName: true },
    })
    if (!raced) throw error
    return raced
  }
}

async function bumpConversationAfterInsert(
  tx: Prisma.TransactionClient,
  args: {
    conversationId: string
    messageId: string
    direction: DualWriteDirection
    content: string
    sentAt: Date
    peerName: string | null
    existingPeerName: string | null
    existingClientId: string | null
    tenantId: string
    peerId: string
    platform?: string | null
  },
) {
  await tx.$queryRaw`SELECT 1 FROM "ChatConversation" WHERE id = ${args.conversationId} FOR UPDATE`

  const current = await tx.chatConversation.findUnique({
    where: { id: args.conversationId },
    select: {
      lastMessageAt: true,
      lastMessageId: true,
      lastInboundAt: true,
      lastOutboundAt: true,
    },
  })
  if (!current) return

  const data: Prisma.ChatConversationUpdateInput = {
    messageCount: { increment: 1 },
  }
  if (
    shouldReplaceConversationPreview(
      { lastMessageAt: current.lastMessageAt, lastMessageId: current.lastMessageId },
      { sentAt: args.sentAt, messageId: args.messageId },
    )
  ) {
    data.lastMessageId = args.messageId
    data.lastMessageAt = args.sentAt
    data.lastMessagePreview = truncatePreview(args.content)
    data.lastMessageDirection = args.direction
  }
  if (args.direction === 'inbound') {
    data.inboundCount = { increment: 1 }
    if (shouldAdvanceConversationTimestamp(current.lastInboundAt, args.sentAt)) {
      data.lastInboundAt = args.sentAt
    }
  } else if (shouldAdvanceConversationTimestamp(current.lastOutboundAt, args.sentAt)) {
    data.lastOutboundAt = args.sentAt
  }
  if (!args.existingPeerName && args.peerName) {
    data.peerName = args.peerName
  }
  if (!args.existingClientId) {
    const clientId = await findClientIdForWhatsAppPeer(
      tx,
      args.tenantId,
      args.peerId,
      args.platform,
    )
    if (clientId) data.client = { connect: { id: clientId } }
  }
  await tx.chatConversation.update({
    where: { id: args.conversationId },
    data,
  })
}

async function findExistingByProviderId(
  tx: Prisma.TransactionClient,
  socialAccountId: string,
  providerMessageId: string,
) {
  const byColumn = await tx.chatMessage.findFirst({
    where: { socialAccountId, providerMessageId },
    select: { id: true, conversationId: true },
  })
  if (byColumn) return byColumn

  return tx.chatMessage.findFirst({
    where: {
      socialAccountId,
      metadata: { path: ['providerMessageId'], equals: providerMessageId },
    },
    select: { id: true, conversationId: true },
  })
}

/**
 * Upsert conversation + insert message in one transaction.
 * Existing provider id / P2002 → duplicate skip (no aggregate bump).
 */
export async function dualWriteChatMessage(
  input: DualWriteMessageInput,
): Promise<DualWriteResult> {
  const peer = deriveConversationPeer({
    direction: input.direction,
    peerId: input.peerId,
    metadata: {
      ...(input.metadata || {}),
      from:
        input.direction === 'inbound'
          ? input.peerId || (input.metadata?.from as string | undefined)
          : (input.metadata?.from as string | undefined),
      to:
        input.direction === 'outbound'
          ? input.peerId || (input.metadata?.to as string | undefined)
          : (input.metadata?.to as string | undefined),
      name: input.peerName || (input.metadata?.name as string | undefined),
    },
  })

  if (!peer.ok) {
    return { ok: false, reason: peer.reason }
  }

  const peerName = input.peerName || peer.peerName
  const providerMessageId = input.providerMessageId?.trim() || null
  const deliveryStatus: DeliveryStatus =
    input.deliveryStatus ||
    (input.direction === 'inbound' ? 'received' : 'pending')

  const legacyMetadata: Record<string, unknown> = {
    ...(input.metadata || {}),
    from:
      input.direction === 'inbound'
        ? peer.peerId
        : (input.metadata?.from as string | undefined),
    to:
      input.direction === 'outbound'
        ? peer.peerId
        : (input.metadata?.to as string | undefined),
    name: peerName || undefined,
    platform: input.platform || undefined,
    providerMessageId: providerMessageId || undefined,
    direction: input.direction,
    messageType: input.messageType || undefined,
    providerMediaId: input.providerMediaId || undefined,
    mediaMimeType: input.mediaMimeType || undefined,
    mediaFilename: input.mediaFilename || undefined,
  }

  try {
    return await prisma.$transaction(async (tx) => {
      if (providerMessageId) {
        const existing = await findExistingByProviderId(
          tx,
          input.socialAccountId,
          providerMessageId,
        )
        if (existing) {
          return {
            ok: true as const,
            duplicate: true as const,
            messageId: existing.id,
            conversationId: existing.conversationId,
            reason: 'duplicate' as const,
          }
        }
      }

      const conversation = await ensureConversation(tx, {
        tenantId: input.tenantId,
        socialAccountId: input.socialAccountId,
        peerId: peer.peerId,
        peerName,
        platform: input.platform,
        sentAt: input.sentAt,
      })

      let message: { id: string }
      try {
        message = await tx.chatMessage.create({
          data: {
            tenantId: input.tenantId,
            socialAccountId: input.socialAccountId,
            clientId: input.clientId ?? undefined,
            orderId: input.orderId ?? undefined,
            direction: input.direction,
            content: input.content,
            metadata: legacyMetadata as Prisma.InputJsonValue,
            sentAt: input.sentAt,
            receivedAt:
              input.receivedAt ??
              (input.direction === 'inbound' ? new Date() : null),
            conversationId: conversation.id,
            providerMessageId,
            peerId: peer.peerId,
            messageType: input.messageType ?? null,
            deliveryStatus,
            statusUpdatedAt: new Date(),
            providerMediaId: input.providerMediaId?.trim() || null,
            mediaMimeType: input.mediaMimeType?.trim() || null,
            mediaFilename: input.mediaFilename?.trim() || null,
          },
          select: { id: true },
        })
      } catch (error) {
        if (isP2002(error) && providerMessageId) {
          const dup = await findExistingByProviderId(
            tx,
            input.socialAccountId,
            providerMessageId,
          )
          return {
            ok: true as const,
            duplicate: true as const,
            messageId: dup?.id ?? null,
            conversationId: dup?.conversationId ?? conversation.id,
            reason: 'duplicate' as const,
          }
        }
        throw error
      }

      await bumpConversationAfterInsert(tx, {
        conversationId: conversation.id,
        messageId: message.id,
        direction: input.direction,
        content: input.content,
        sentAt: input.sentAt,
        peerName,
        existingPeerName: conversation.peerName,
        existingClientId: conversation.clientId,
        tenantId: input.tenantId,
        peerId: peer.peerId,
        platform: input.platform,
      })

      await tx.socialAccount.update({
        where: { id: input.socialAccountId },
        data:
          input.direction === 'inbound'
            ? { lastWebhookAt: new Date() }
            : { lastSendAt: new Date() },
      })

      return {
        ok: true as const,
        duplicate: false as const,
        messageId: message.id,
        conversationId: conversation.id,
        tenantId: input.tenantId,
        socialAccountId: input.socialAccountId,
        peerId: peer.peerId,
        direction: input.direction,
        content: input.content,
        peerName,
        suppressSoftAi:
          Boolean(input.suppressSoftAi) || input.direction !== 'inbound',
      }
    })
  } catch (error) {
    if (isP2002(error)) {
      return {
        ok: true,
        duplicate: true,
        messageId: null,
        conversationId: null,
        reason: 'duplicate',
      }
    }
    console.error('[chat-conversation-write] dualWrite failed', error)
    return {
      ok: false,
      reason: 'error',
      error: error instanceof Error ? error.message : 'unknown',
    }
  }
}

/**
 * Update outbound row after Graph call (pending → sent/failed).
 * Marks the sender's read state current when userId is provided.
 */
export async function finalizeOutboundDelivery(args: {
  messageId: string
  tenantId: string
  conversationId: string
  userId?: string | null
  providerMessageId?: string | null
  deliveryStatus: 'sent' | 'failed'
  errorCode?: string | null
  providerResponse?: unknown
}): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const existing = await tx.chatMessage.findFirst({
      where: { id: args.messageId, tenantId: args.tenantId },
      select: {
        id: true,
        deliveryStatus: true,
        metadata: true,
        providerMessageId: true,
      },
    })
    if (!existing) return

    if (
      !isDeliveryStatusMonotonicUpgrade(
        existing.deliveryStatus,
        args.deliveryStatus,
      )
    ) {
      return
    }

    const meta =
      existing.metadata &&
      typeof existing.metadata === 'object' &&
      !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {}
    if (args.providerMessageId) meta.providerMessageId = args.providerMessageId
    if (args.providerResponse !== undefined) {
      meta.providerResponse = args.providerResponse
    }

    await tx.chatMessage.update({
      where: { id: existing.id },
      data: {
        deliveryStatus: args.deliveryStatus,
        statusUpdatedAt: now,
        providerMessageId: args.providerMessageId || existing.providerMessageId,
        failedAt: args.deliveryStatus === 'failed' ? now : undefined,
        errorCode: args.errorCode ?? undefined,
        metadata: meta as Prisma.InputJsonValue,
      },
    })

    await tx.chatConversation.update({
      where: { id: args.conversationId },
      data: { lastOutboundAt: now },
    })

    if (args.userId) {
      const conversation = await tx.chatConversation.findUnique({
        where: { id: args.conversationId },
        select: { inboundCount: true, lastMessageId: true },
      })
      if (conversation) {
        await tx.chatConversationReadState.upsert({
          where: {
            conversationId_userId: {
              conversationId: args.conversationId,
              userId: args.userId,
            },
          },
          create: {
            tenantId: args.tenantId,
            conversationId: args.conversationId,
            userId: args.userId,
            readInboundCount: conversation.inboundCount,
            lastReadAt: now,
            lastReadMessageId: conversation.lastMessageId,
          },
          update: {
            readInboundCount: conversation.inboundCount,
            lastReadAt: now,
            lastReadMessageId: conversation.lastMessageId,
          },
        })
      }
    }
  })
}

export async function applyDeliveryStatusUpdate(args: {
  socialAccountId: string
  providerMessageId: string
  status: DeliveryStatus
  statusAt?: Date
  errorCode?: string | null
}): Promise<{ updated: boolean; reason?: string }> {
  if (!args.providerMessageId) {
    return { updated: false, reason: 'missing_provider_id' }
  }

  const message = await prisma.chatMessage.findFirst({
    where: {
      socialAccountId: args.socialAccountId,
      OR: [
        { providerMessageId: args.providerMessageId },
        {
          metadata: {
            path: ['providerMessageId'],
            equals: args.providerMessageId,
          },
        },
      ],
    },
    select: {
      id: true,
      deliveryStatus: true,
      deliveredAt: true,
      readAt: true,
      failedAt: true,
    },
  })

  if (!message) return { updated: false, reason: 'not_found' }
  if (!isDeliveryStatusMonotonicUpgrade(message.deliveryStatus, args.status)) {
    return { updated: false, reason: 'non_monotonic' }
  }

  const at = args.statusAt || new Date()
  const data: Prisma.ChatMessageUpdateInput = {
    deliveryStatus: args.status,
    statusUpdatedAt: at,
  }
  if (args.status === 'delivered') data.deliveredAt = at
  if (args.status === 'read') {
    data.readAt = at
    if (!message.deliveredAt) data.deliveredAt = at
  }
  if (args.status === 'failed') {
    data.failedAt = at
    data.errorCode = args.errorCode ?? undefined
  }

  await prisma.chatMessage.update({ where: { id: message.id }, data })
  return { updated: true }
}

/**
 * IG watermark-style read: mark outbound messages to peer as read up to timestamp.
 */
export async function applyPeerReadWatermark(args: {
  socialAccountId: string
  peerId: string
  readAt: Date
}): Promise<number> {
  const candidates = await prisma.chatMessage.findMany({
    where: {
      socialAccountId: args.socialAccountId,
      peerId: args.peerId,
      direction: 'outbound',
      sentAt: { lte: args.readAt },
      OR: [
        { deliveryStatus: null },
        { deliveryStatus: { in: ['pending', 'sent', 'delivered'] } },
      ],
    },
    select: { id: true, deliveryStatus: true },
    take: 200,
  })

  let updated = 0
  for (const row of candidates) {
    if (!isDeliveryStatusMonotonicUpgrade(row.deliveryStatus, 'read')) continue
    await prisma.chatMessage.update({
      where: { id: row.id },
      data: {
        deliveryStatus: 'read',
        statusUpdatedAt: args.readAt,
        readAt: args.readAt,
        deliveredAt: args.readAt,
      },
    })
    updated += 1
  }
  return updated
}
