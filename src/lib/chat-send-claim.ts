import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import type { DualWriteResult } from '@/lib/chat-conversation-write'

/**
 * One send per (business, clientRequestId), held in the database BEFORE the message goes to Meta
 * (Rafael 2026-10-22: "duplicate message + error though it was delivered"). A retry or a second tab
 * with the same id never sends twice; a send that went out is never reported as an error.
 *
 * Table "ChatSendClaim" comes from supabase/migrations/057_chat_send_claim.sql (not in schema.prisma,
 * raw SQL only). Until 057 is applied every claim is `unavailable` and the routes fall back to the
 * message lookup by metadata.clientRequestId (best effort, same as before).
 */

export type ChatSendClaim =
  /** This request owns the id: send it. */
  | { kind: 'claimed' }
  /** An earlier request with this id already went out (Meta accepted it). */
  | { kind: 'delivered'; providerMessageId: string | null; messageId: string | null }
  /** Another request with this id is sending right now. */
  | { kind: 'in_flight' }
  /** No id, or 057 not applied / claim store unreachable: send without the guarantee. */
  | { kind: 'unavailable' }

/** A 'sending' claim older than this belongs to a request that died; a retry may take it over. */
export const CHAT_SEND_CLAIM_STALE_MS = 2 * 60 * 1000
/** Same id after this is a new send (matches the 24 h stored-message lookup). */
export const CHAT_SEND_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000
const CLAIM_RETENTION_DAYS = 3

type RawDb = Pick<typeof prisma, '$queryRaw' | '$executeRaw'>

type ClaimRow = {
  status: string
  providerMessageId: string | null
  messageId: string | null
  updatedAt: Date
}

export function isValidClientRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value)
}

/** Ids only the server builds (guía sends: `guia:<guiaId>:<conversationId>`); a browser may not pre-claim them. */
const SERVER_ONLY_ID_PREFIXES = ['guia:']

/** A clientRequestId as sent by the browser: valid shape and not a server-reserved prefix (SecureDog DATA-CLAIM-1). */
export function browserClientRequestId(raw: unknown): string | null {
  const value = String(raw ?? '').trim()
  if (!isValidClientRequestId(value)) return null
  const lower = value.toLowerCase()
  return SERVER_ONLY_ID_PREFIXES.some((p) => lower.startsWith(p)) ? null : value
}

export async function claimChatSend(
  tenantId: string,
  clientRequestId: string | null | undefined,
  db: RawDb = prisma,
  now = new Date(),
): Promise<ChatSendClaim> {
  if (!isValidClientRequestId(clientRequestId)) return { kind: 'unavailable' }
  try {
    const inserted = await db.$queryRaw<Array<{ ok: number }>>`
      INSERT INTO "ChatSendClaim" ("tenantId", "clientRequestId", "status", "createdAt", "updatedAt")
      VALUES (${tenantId}, ${clientRequestId}, 'sending', ${now}, ${now})
      ON CONFLICT ("tenantId", "clientRequestId") DO NOTHING
      RETURNING 1 AS ok`
    if (inserted.length > 0) {
      if (Math.random() < 0.02) void pruneChatSendClaims(db, now)
      return { kind: 'claimed' }
    }
    const rows = await db.$queryRaw<ClaimRow[]>`
      SELECT "status", "providerMessageId", "messageId", "updatedAt" FROM "ChatSendClaim"
      WHERE "tenantId" = ${tenantId} AND "clientRequestId" = ${clientRequestId}`
    const row = rows[0]
    if (!row) return { kind: 'in_flight' }
    const deliveredAfter = new Date(now.getTime() - CHAT_SEND_DEDUPE_WINDOW_MS)
    if (row.status === 'delivered' && row.updatedAt >= deliveredAfter) {
      return { kind: 'delivered', providerMessageId: row.providerMessageId, messageId: row.messageId }
    }
    // 'failed' (Meta refused it) is free to retry; a stale 'sending' died mid-request; a delivery older
    // than the dedupe window is a new send (same window as the stored-message lookup).
    const staleBefore = new Date(now.getTime() - CHAT_SEND_CLAIM_STALE_MS)
    const taken = await db.$queryRaw<Array<{ ok: number }>>`
      UPDATE "ChatSendClaim"
      SET "status" = 'sending', "updatedAt" = ${now}, "providerMessageId" = NULL, "messageId" = NULL
      WHERE "tenantId" = ${tenantId} AND "clientRequestId" = ${clientRequestId}
        AND ("status" = 'failed'
          OR ("status" = 'sending' AND "updatedAt" < ${staleBefore})
          OR ("status" = 'delivered' AND "updatedAt" < ${deliveredAfter}))
      RETURNING 1 AS ok`
    return taken.length > 0 ? { kind: 'claimed' } : { kind: 'in_flight' }
  } catch (error) {
    if (!isMissingRelation(error)) {
      console.warn('[chat-send-claim] claim skipped', error instanceof Error ? error.name : 'unknown')
    }
    return { kind: 'unavailable' }
  }
}

/** Meta accepted the message: the id stays taken (a retry returns this message, never re-sends). */
export async function markChatSendDelivered(
  tenantId: string,
  clientRequestId: string | null | undefined,
  ids: { providerMessageId?: string | null; messageId?: string | null },
  db: RawDb = prisma,
): Promise<void> {
  if (!isValidClientRequestId(clientRequestId)) return
  try {
    await db.$executeRaw`
      UPDATE "ChatSendClaim"
      SET "status" = 'delivered', "updatedAt" = ${new Date()},
          "providerMessageId" = COALESCE(${ids.providerMessageId ?? null}, "providerMessageId"),
          "messageId" = COALESCE(${ids.messageId ?? null}, "messageId")
      WHERE "tenantId" = ${tenantId} AND "clientRequestId" = ${clientRequestId}`
  } catch (error) {
    if (!isMissingRelation(error)) console.warn('[chat-send-claim] mark delivered skipped')
  }
}

/** Meta refused it (or it never left): Retry may send it again. */
export async function releaseChatSend(
  tenantId: string,
  clientRequestId: string | null | undefined,
  db: RawDb = prisma,
): Promise<void> {
  if (!isValidClientRequestId(clientRequestId)) return
  try {
    await db.$executeRaw`
      UPDATE "ChatSendClaim" SET "status" = 'failed', "updatedAt" = ${new Date()}
      WHERE "tenantId" = ${tenantId} AND "clientRequestId" = ${clientRequestId} AND "status" = 'sending'`
  } catch (error) {
    if (!isMissingRelation(error)) console.warn('[chat-send-claim] release skipped')
  }
}

async function pruneChatSendClaims(db: RawDb, now: Date): Promise<void> {
  const before = new Date(now.getTime() - CLAIM_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  try {
    await db.$executeRaw`DELETE FROM "ChatSendClaim" WHERE "createdAt" < ${before}`
  } catch {
    // best effort
  }
}

type MessageDb = {
  chatMessage: {
    findFirst: (args: any) => Promise<any>
    updateMany: (args: any) => Promise<unknown>
  }
}

/** The outbound row an earlier request with this id stored (tenant + line scoped, last 24 h). */
export async function findOutboundByClientRequestId(
  db: MessageDb,
  opts: { tenantId: string; socialAccountId: string; clientRequestId: string | null | undefined },
): Promise<any | null> {
  if (!isValidClientRequestId(opts.clientRequestId)) return null
  return db.chatMessage.findFirst({
    where: {
      tenantId: opts.tenantId,
      socialAccountId: opts.socialAccountId,
      direction: 'outbound',
      sentAt: { gte: new Date(Date.now() - CHAT_SEND_DEDUPE_WINDOW_MS) },
      metadata: { path: ['clientRequestId'], equals: opts.clientRequestId },
    },
  })
}

/**
 * The row a delivered send ended up in. A duplicate write means the webhook echo stored the same
 * Meta message first: use that row and stamp our clientRequestId (and sender) on it, so the
 * optimistic bubble merges into it instead of showing twice.
 */
export async function resolveDeliveredOutboundRow(
  db: MessageDb,
  write: DualWriteResult,
  opts: {
    tenantId: string
    socialAccountId: string
    providerMessageId: string | null | undefined
    clientRequestId: string | null | undefined
    metadata: Record<string, unknown>
  },
): Promise<{ messageId: string; conversationId: string } | null> {
  if (write.ok && !write.duplicate && write.messageId && write.conversationId) {
    return { messageId: write.messageId, conversationId: write.conversationId }
  }
  const providerMessageId = opts.providerMessageId?.trim()
  if (!providerMessageId) return null
  const row = await db.chatMessage.findFirst({
    where: { tenantId: opts.tenantId, socialAccountId: opts.socialAccountId, providerMessageId },
    select: { id: true, conversationId: true, metadata: true },
  })
  if (!row?.conversationId) return null
  const meta =
    row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {}
  // Echo fields (webhookField, rawMessage…) stay; ours only fill what the echo does not carry.
  const next = { ...opts.metadata, ...meta }
  if (isValidClientRequestId(opts.clientRequestId)) next.clientRequestId = opts.clientRequestId
  await db.chatMessage.updateMany({
    where: { id: row.id, tenantId: opts.tenantId },
    data: { metadata: next as Prisma.InputJsonValue },
  })
  return { messageId: row.id, conversationId: row.conversationId }
}
