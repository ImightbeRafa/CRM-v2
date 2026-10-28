/**
 * Transactional dual-write for ChatConversation + ChatMessage (Respond.io PR-2).
 * Keeps legacy metadata JSON so flag-off clients continue to work.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isTransientDbError, withDbRetry } from '@/lib/db-retry'
import {
  compareMessageOrder,
  deriveConversationPeer,
  toMessageDate,
  truncatePreview,
} from '@/lib/chat-conversation-foundation'
import { normalizeClientPhone } from '@/lib/order-lifecycle'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  parseChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-config'

export const DELIVERY_STATUS_RANK = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
  received: 0,
} as const

export type DeliveryStatus = keyof typeof DELIVERY_STATUS_RANK

/**
 * Outbound statuses that count as a team reply (Meta accepted it). Never pending / failed; a later
 * async 'failed' status recomputes the marker (applyDeliveryStatusUpdate).
 */
export function isConfirmedReplyStatus(status: string | null | undefined): boolean {
  return status === 'sent' || status === 'delivered' || status === 'read'
}

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
  /** Human agent who sent this outbound (null for Soft AI / webhooks). */
  senderUserId?: string | null
  /**
   * Follow-up / reactivation sends: update the preview but keep `lastMessageAt`, so a mass nudge never pushes chats
   * to the top of the inbox (Rafael 2026-10-18). The customer's reply moves the chat up as usual.
   */
  keepListPosition?: boolean
  /**
   * AI replies: the inbound message this reply answers. Only customer messages up to that one are
   * marked answered for the team (a message that arrived while the AI was thinking stays pending).
   */
  answersMessageId?: string | null
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
      /** 'transient': the database could not be reached in time (2026-10-23): the caller should make the sender retry. */
      reason: 'missing_peer' | 'literal_unknown' | 'error' | 'transient'
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

/** P2002 on ChatConversation (tenantId, socialAccountId, peerId): two first messages of a new chat at once. */
export function isConversationRace(error: unknown): boolean {
  if (!isP2002(error)) return false
  const target = (error as Prisma.PrismaClientKnownRequestError).meta?.target
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return /peerId|ChatConversation/i.test(text) && !/providerMessageId/i.test(text)
}

/**
 * Explicit transaction budget (Prisma defaults: 2 s to start, 5 s to finish). A busy pool may wait up to
 * 5 s for a connection instead of failing the webhook after 2 s (2026-10-23 incident).
 */
const DUAL_WRITE_TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const

const ACTIVITY_TOUCH_MS = 60_000

/**
 * "Last webhook / last send" stamp on the line, after the message committed. It was written inside every
 * message transaction: one hot row per line that serialized concurrent webhooks (ShareLock waits during
 * Meta's retry burst). Now best effort, at most once a minute, and always while the line carries an error
 * marker so the quiet-line check clears a recovered line on its next run. Never blocks or fails the write.
 */
function touchSocialAccountActivity(socialAccountId: string, direction: DualWriteDirection): void {
  const now = new Date()
  const cutoff = new Date(now.getTime() - ACTIVITY_TOUCH_MS)
  const where: Prisma.SocialAccountWhereInput =
    direction === 'inbound'
      ? { id: socialAccountId, OR: [{ lastWebhookAt: null }, { lastWebhookAt: { lt: cutoff } }, { lastErrorCode: { not: null } }] }
      : { id: socialAccountId, OR: [{ lastSendAt: null }, { lastSendAt: { lt: cutoff } }] }
  void prisma.socialAccount
    .updateMany({ where, data: direction === 'inbound' ? { lastWebhookAt: now } : { lastSendAt: now } })
    .catch((error: unknown) => {
      const e = error as { code?: unknown } | null
      console.warn('[chat-conversation-write] activity touch failed', { code: typeof e?.code === 'string' ? e.code : undefined })
    })
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

  // New conversations auto-activate only when the layer flag is on,
  // autoActivateNewConversations is true, and the account is allowlisted.
  // An empty allowlist activates nobody. Existing rows stay untouched.
  let aiMode: string | undefined
  try {
    const flag = await tx.tenantFeatureFlag.findFirst({
      where: {
        tenantId: args.tenantId,
        scope: args.tenantId,
        key: CHAT_AGENT_LAYER_V1_FLAG,
      },
      select: { enabled: true, config: true },
    })
    if (flag?.enabled) {
      const cfg = parseChatAgentLayerConfig(flag.config)
      if (
        cfg.autoActivateNewConversations &&
        cfg.accountAllowlist.includes(args.socialAccountId)
      ) {
        aiMode = 'ai_active'
      }
    }
  } catch {
    // Flag/table unavailable — leave aiMode unset (fail closed).
  }

  // A concurrent first message can create this chat between the lookup and this INSERT: the P2002 then
  // aborts the transaction (no query can run on tx any more, 25P02), so it propagates as is and
  // dualWriteChatMessage reruns the whole write once (the chat exists by then).
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
      ...(aiMode ? { aiMode } : {}),
    },
    select: { id: true, clientId: true, peerName: true },
  })
  return created
}

/** Customer messages (non-duplicate) sent at or before `upTo`, capped by the inbound counter. */
async function countTeamAnsweredInbound(
  tx: Prisma.TransactionClient,
  conversationId: string,
  upTo: Date,
  inboundCount: number,
): Promise<number> {
  const answered = await tx.chatMessage.count({
    where: { conversationId, direction: 'inbound', duplicateOfMessageId: null, sentAt: { lte: upTo } },
  })
  return Math.max(0, Math.min(inboundCount, answered))
}

/** Exported for tests only. */
export async function bumpConversationAfterInsert(
  tx: Prisma.TransactionClient,
  args: {
    conversationId: string
    messageId: string
    direction: DualWriteDirection
    deliveryStatus: DeliveryStatus
    answersMessageId?: string | null
    content: string
    sentAt: Date
    peerName: string | null
    existingPeerName: string | null
    existingClientId: string | null
    tenantId: string
    peerId: string
    platform?: string | null
    keepListPosition?: boolean
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
      inboundCount: true,
      repliedInboundCount: true,
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
    if (!args.keepListPosition) data.lastMessageAt = args.sentAt
    data.lastMessagePreview = truncatePreview(args.content)
    data.lastMessageDirection = args.direction
  }
  if (args.direction === 'inbound') {
    data.inboundCount = { increment: 1 }
    if (shouldAdvanceConversationTimestamp(current.lastInboundAt, args.sentAt)) {
      data.lastInboundAt = args.sentAt
    }
  } else {
    if (shouldAdvanceConversationTimestamp(current.lastOutboundAt, args.sentAt)) {
      data.lastOutboundAt = args.sentAt
    }
    // A confirmed reply answers, for the whole team, the customer messages received up to it (row is
    // locked). Late echoes / WhatsApp history / AI replies never cover newer messages. A Betsy send
    // is written 'pending' first and only counts once finalized as sent.
    if (isConfirmedReplyStatus(args.deliveryStatus) && current.inboundCount > current.repliedInboundCount) {
      let upTo = args.sentAt
      if (args.answersMessageId) {
        const trigger = await tx.chatMessage.findFirst({
          where: { id: args.answersMessageId, tenantId: args.tenantId, conversationId: args.conversationId, direction: 'inbound' },
          select: { sentAt: true },
        })
        if (trigger && trigger.sentAt < upTo) upTo = trigger.sentAt
      }
      const replied = await countTeamAnsweredInbound(tx, args.conversationId, upTo, current.inboundCount)
      if (replied > current.repliedInboundCount) data.repliedInboundCount = replied
    }
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

function metaRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/**
 * Rafael 2026-10-28 (DeepSleep audit): Instagram's echo of an AI / follow-up send often lands before the send's own
 * write, so the row kept the echo metadata (no `softAi`). The inbox showed it as a person, and the next part of the
 * reply stopped ("a person replied" → partial_delivery), later customer messages were skipped (human_before_send).
 * Same provider message id = the very message the AI sent: the AI write's metadata wins over the bare echo.
 * Returns null when the existing row is not a bare echo (a person's send, or already marked) — nothing changes.
 */
export function adoptedEchoMetadata(existing: unknown, incoming: Record<string, unknown> | undefined): Record<string, unknown> | null {
  const prev = metaRecord(existing)
  if (incoming?.softAi !== true) return null
  if (prev.isEcho !== true || prev.softAi === true || prev.senderUserId) return null
  return { ...prev, ...incoming, isEcho: true }
}

async function adoptSoftAiEcho(
  client: Prisma.TransactionClient,
  input: DualWriteMessageInput,
  existingId: string | null | undefined,
): Promise<void> {
  if (!existingId || input.direction !== 'outbound' || input.metadata?.softAi !== true) return
  const row = await client.chatMessage.findFirst({
    where: { id: existingId, tenantId: input.tenantId, direction: 'outbound' },
    select: { id: true, metadata: true },
  })
  const merged = row ? adoptedEchoMetadata(row.metadata, input.metadata) : null
  if (!row || !merged) return
  await client.chatMessage.update({ where: { id: row.id }, data: { metadata: merged as Prisma.InputJsonValue } })
}

/** Best effort: the duplicate result stands whatever happens here (name / code only in the log). */
async function adoptSoftAiEchoSafe(input: DualWriteMessageInput, existingId: string | null | undefined): Promise<void> {
  try {
    await adoptSoftAiEcho(prisma as unknown as Prisma.TransactionClient, input, existingId)
  } catch (error) {
    const e = error as { name?: unknown; code?: unknown } | null
    console.error('[chat-conversation-write] echo adoption failed', {
      name: typeof e?.name === 'string' ? e.name : undefined,
      code: typeof e?.code === 'string' ? e.code : undefined,
    })
  }
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

  const writeOnce = () =>
    prisma.$transaction(async (tx) => {
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
            // ChatMessage.senderUserId column is gated on SQL 031. Human attribution
            // is persisted in metadata.senderUserId/Name/Image (Respond.io-style snapshot).
            deliveryStatus,
            statusUpdatedAt: new Date(),
            providerMediaId: input.providerMediaId?.trim() || null,
            mediaMimeType: input.mediaMimeType?.trim() || null,
            mediaFilename: input.mediaFilename?.trim() || null,
          },
          select: { id: true },
        })
      } catch (error) {
        // Same message stored by a concurrent delivery (Meta retry): the failed INSERT aborted the
        // transaction, so the duplicate lookup happens outside it (catch below).
        throw error
      }

      await bumpConversationAfterInsert(tx, {
        conversationId: conversation.id,
        messageId: message.id,
        direction: input.direction,
        deliveryStatus,
        answersMessageId: input.answersMessageId ?? null,
        content: input.content,
        sentAt: input.sentAt,
        peerName,
        existingPeerName: conversation.peerName,
        existingClientId: conversation.clientId,
        tenantId: input.tenantId,
        peerId: peer.peerId,
        platform: input.platform,
        keepListPosition: input.keepListPosition === true,
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
    }, DUAL_WRITE_TX_OPTIONS)

  try {
    let result: DualWriteResult
    try {
      // Retries only when the transaction never started (connect / pool / start timeout).
      result = await withDbRetry(writeOnce)
    } catch (error) {
      if (!isConversationRace(error)) throw error
      // The chat was created by a concurrent first message: it exists now, one rerun picks it up.
      result = await withDbRetry(writeOnce)
    }
    // After the transaction: a failed adoption never turns the duplicate into a write failure (Verifier 2026-10-28 #3).
    if (result.ok && result.duplicate) await adoptSoftAiEchoSafe(input, result.messageId)
    if (result.ok && !result.duplicate) {
      touchSocialAccountActivity(input.socialAccountId, input.direction)
    }
    return result
  } catch (error) {
    if (isP2002(error)) {
      const dup = providerMessageId
        ? await findExistingByProviderId(prisma as unknown as Prisma.TransactionClient, input.socialAccountId, providerMessageId).catch(() => null)
        : null
      await adoptSoftAiEchoSafe(input, dup?.id)
      return {
        ok: true,
        duplicate: true,
        messageId: dup?.id ?? null,
        conversationId: dup?.conversationId ?? null,
        reason: 'duplicate',
      }
    }
    const transient = isTransientDbError(error)
    // Name / code only: a Prisma validation error prints the whole row (phone, text, raw message).
    const e = error as { name?: unknown; code?: unknown; errorCode?: unknown } | null
    console.error('[chat-conversation-write] dualWrite failed', {
      name: typeof e?.name === 'string' ? e.name : undefined,
      code: typeof e?.code === 'string' ? e.code : typeof e?.errorCode === 'string' ? e.errorCode : undefined,
      transient,
    })
    return {
      ok: false,
      reason: transient ? 'transient' : 'error',
      error: error instanceof Error ? error.message : 'unknown',
    }
  }
}

/**
 * Update outbound row after Graph call (pending → sent/failed).
 * Echo-first duplicates are already `sent`; still merge send metadata and
 * mark the sender's read state current when userId is provided.
 */
export type FinalizeOutboundDeliveryArgs = {
  messageId: string
  tenantId: string
  conversationId: string
  userId?: string | null
  providerMessageId?: string | null
  deliveryStatus: 'sent' | 'failed'
  errorCode?: string | null
  providerResponse?: unknown
  now?: Date
}

export type FinalizeOutboundDeliveryResult = 'missing' | 'updated' | 'reconciled'

export async function finalizeOutboundDeliveryWithClient(
  tx: Prisma.TransactionClient,
  args: FinalizeOutboundDeliveryArgs,
): Promise<FinalizeOutboundDeliveryResult> {
  const now = args.now ?? new Date()
  const existing = await tx.chatMessage.findFirst({
    where: { id: args.messageId, tenantId: args.tenantId },
    select: {
      id: true,
      deliveryStatus: true,
      metadata: true,
      providerMessageId: true,
      conversationId: true,
      sentAt: true,
    },
  })
  if (!existing) return 'missing'

  const canUpgrade = isDeliveryStatusMonotonicUpgrade(
    existing.deliveryStatus,
    args.deliveryStatus,
  )

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

  const nextProviderId = args.providerMessageId || existing.providerMessageId
  const shouldPatchMessage =
    canUpgrade ||
    Boolean(args.providerMessageId && args.providerMessageId !== existing.providerMessageId) ||
    args.providerResponse !== undefined

  if (shouldPatchMessage) {
    const data: Prisma.ChatMessageUpdateInput = {
      providerMessageId: nextProviderId,
      metadata: meta as Prisma.InputJsonValue,
    }
    if (canUpgrade) {
      data.deliveryStatus = args.deliveryStatus
      data.statusUpdatedAt = now
      data.errorCode = args.errorCode ?? undefined
      if (args.deliveryStatus === 'failed') data.failedAt = now
    }
    await tx.chatMessage.update({
      where: { id: existing.id },
      data,
    })
  }

  if (args.deliveryStatus === 'sent') {
    await tx.$queryRaw`SELECT 1 FROM "ChatConversation" WHERE id = ${args.conversationId} AND "tenantId" = ${args.tenantId} FOR UPDATE`
  }
  const conversation = await tx.chatConversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: {
      inboundCount: true,
      repliedInboundCount: true,
      lastMessageId: true,
      lastOutboundAt: true,
    },
  })
  const convData: Prisma.ChatConversationUpdateInput = {}
  if (conversation && shouldAdvanceConversationTimestamp(conversation.lastOutboundAt, now)) {
    convData.lastOutboundAt = now
  }
  // The row's real status after this call: an async 'failed' that landed first is never overridden.
  const effectiveStatus = canUpgrade ? args.deliveryStatus : existing.deliveryStatus
  if (
    conversation &&
    args.deliveryStatus === 'sent' &&
    isConfirmedReplyStatus(effectiveStatus) &&
    existing.conversationId === args.conversationId
  ) {
    // The reply answers the customer messages received up to when it was written; later ones stay
    // pending. Counted from rows, capped by the counter (conservative: never over-marks).
    const replied = await countTeamAnsweredInbound(tx, args.conversationId, existing.sentAt, conversation.inboundCount)
    if (replied > conversation.repliedInboundCount) convData.repliedInboundCount = replied
  }
  if (conversation && Object.keys(convData).length) {
    await tx.chatConversation.update({
      where: { id: args.conversationId },
      data: convData,
    })
  }

  if (args.userId && conversation) {
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

  return canUpgrade ? 'updated' : 'reconciled'
}

export async function finalizeOutboundDelivery(
  args: FinalizeOutboundDeliveryArgs,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await finalizeOutboundDeliveryWithClient(tx, args)
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
      tenantId: true,
      conversationId: true,
      direction: true,
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

  if (args.status === 'failed' && message.direction === 'outbound' && message.conversationId) {
    const conversationId = message.conversationId
    await prisma.$transaction(async (tx) => {
      await tx.chatMessage.update({ where: { id: message.id }, data })
      await recomputeTeamRepliedAfterFailure(tx, conversationId, message.tenantId)
    })
    return { updated: true }
  }

  await prisma.chatMessage.update({ where: { id: message.id }, data })
  return { updated: true }
}

/**
 * Meta accepted a reply, then reported it failed (e.g. outside the 24 h window): the customer never
 * got it, so the team marker falls back to the latest reply that did not fail.
 */
async function recomputeTeamRepliedAfterFailure(
  tx: Prisma.TransactionClient,
  conversationId: string,
  tenantId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "ChatConversation" WHERE id = ${conversationId} AND "tenantId" = ${tenantId} FOR UPDATE`
  const conversation = await tx.chatConversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { inboundCount: true, repliedInboundCount: true },
  })
  if (!conversation) return
  const lastReply = await tx.chatMessage.findFirst({
    where: { conversationId, direction: 'outbound', deliveryStatus: { in: ['sent', 'delivered', 'read'] } },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  })
  const replied = lastReply
    ? await countTeamAnsweredInbound(tx, conversationId, lastReply.sentAt, conversation.inboundCount)
    : 0
  if (replied < conversation.repliedInboundCount) {
    await tx.chatConversation.update({ where: { id: conversationId }, data: { repliedInboundCount: replied } })
  }
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
