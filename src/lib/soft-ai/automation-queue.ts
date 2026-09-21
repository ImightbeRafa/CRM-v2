/**
 * Soft AI durable automation queue — lease/claim/retry.
 * Copies BotInboxMessage algorithms; shares no bot tables or imports.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export const SOFT_AI_JOB_KIND = 'soft_ai_inbound' as const
export const LEASE_MS = 45_000
export const PROCESSING_TIMEOUT_MS = 25_000
export const MAX_ATTEMPTS = 5

export type SoftAiJobStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed'
  | 'failed'
  | 'ambiguous'

export type ClaimedChatAutomationJob = {
  id: string
  tenantId: string
  conversationId: string
  messageId: string
  socialAccountId: string
  peerId: string
  kind: string
  deliveryKey: string
  payload: unknown
  attempts: number
  leaseToken: string
}

export function softAiInboundDeliveryKey(messageId: string) {
  return `soft_ai_inbound:${messageId}`
}

export function retryDelayMs(attempts: number) {
  return Math.min(15 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1))
}

export function safeErrorCode(error: unknown) {
  if (error instanceof Error && error.name === 'ChatAutomationTimeoutError') {
    return 'processing_timeout'
  }
  if (error instanceof Error && /^[A-Z0-9_:-]{3,80}$/.test(error.message)) {
    return error.message.slice(0, 80)
  }
  return 'processing_failed'
}

export async function persistJob(input: {
  tenantId: string
  conversationId: string
  messageId: string
  socialAccountId: string
  peerId: string
  platform?: string
  content?: string
  senderName?: string | null
  kind?: typeof SOFT_AI_JOB_KIND
  deliveryKey?: string
  payload?: Record<string, unknown>
}) {
  const deliveryKey = input.deliveryKey || softAiInboundDeliveryKey(input.messageId)
  const payload = {
    platform: input.platform || null,
    content: input.content || null,
    senderName: input.senderName ?? null,
    ...(input.payload || {}),
  }

  try {
    const row = await prisma.chatAutomationJob.create({
      data: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        socialAccountId: input.socialAccountId,
        peerId: input.peerId,
        kind: input.kind || SOFT_AI_JOB_KIND,
        deliveryKey,
        payload: payload as Prisma.InputJsonValue,
      },
      select: { id: true, status: true, deliveryKey: true },
    })
    return { ...row, duplicate: false as const }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.chatAutomationJob.findUnique({
        where: { deliveryKey },
        select: { id: true, status: true, deliveryKey: true },
      })
      if (existing) return { ...existing, duplicate: true as const }
    }
    throw error
  }
}

async function supersedeOlderJobs(conversationId: string, keepId: string) {
  await prisma.chatAutomationJob.updateMany({
    where: {
      conversationId,
      id: { not: keepId },
      status: { in: ['pending', 'retry'] },
    },
    data: {
      status: 'completed',
      lastErrorCode: 'SUPERSEDED',
      processedAt: new Date(),
      payload: Prisma.DbNull,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

async function deferJob(id: string, delayMs = 5_000) {
  await prisma.chatAutomationJob.updateMany({
    where: { id, status: { in: ['pending', 'retry', 'processing'] } },
    data: {
      status: 'pending',
      availableAt: new Date(Date.now() + delayMs),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
}

async function claimRows(id?: string, limit = 1): Promise<ClaimedChatAutomationJob[]> {
  const leaseToken = randomUUID()
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS)
  // Prefer the newest pending job per conversation; older siblings are
  // SUPERSEDED after a successful claim (A1 single-flight / burst coalesce).
  // Single-flight partial unique on status=processing defers concurrent claimants.
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string
        tenantId: string
        conversationId: string
        messageId: string
        socialAccountId: string
        peerId: string
        kind: string
        deliveryKey: string
        payload: unknown
        attempts: number
        leaseToken: string
      }>
    >(Prisma.sql`
      WITH candidate AS (
        SELECT current."id", current."conversationId"
        FROM "ChatAutomationJob" current
        WHERE (${id || null}::text IS NULL OR current."id" = ${id || null})
          AND current."availableAt" <= CURRENT_TIMESTAMP
          AND EXISTS (
            SELECT 1
            FROM "TenantFeatureFlag" flag
            WHERE flag."tenantId" = current."tenantId"
              AND flag."scope" = current."tenantId"
              AND flag."key" = 'soft_tenant_ai_v1'
              AND flag."enabled" = true
          )
          AND (
            current."status" IN ('pending', 'retry')
            OR (current."status" = 'processing' AND current."leaseExpiresAt" <= CURRENT_TIMESTAMP)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ChatAutomationJob" newer
            WHERE newer."conversationId" = current."conversationId"
              AND (newer."createdAt", newer."id") > (current."createdAt", current."id")
              AND newer."status" IN ('pending', 'retry')
              AND newer."availableAt" <= CURRENT_TIMESTAMP
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ChatAutomationJob" inflight
            WHERE inflight."conversationId" = current."conversationId"
              AND inflight."status" = 'processing'
              AND inflight."leaseExpiresAt" > CURRENT_TIMESTAMP
              AND inflight."id" <> current."id"
          )
        ORDER BY current."createdAt" DESC, current."id" DESC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "ChatAutomationJob" job
      SET "status" = 'processing',
          "attempts" = job."attempts" + 1,
          "leaseToken" = ${leaseToken},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "processingStartedAt" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM candidate
      WHERE job."id" = candidate."id"
      RETURNING job."id", job."tenantId", job."conversationId", job."messageId",
        job."socialAccountId", job."peerId", job."kind", job."deliveryKey",
        job."payload", job."attempts", job."leaseToken"
    `)

    for (const row of rows) {
      await supersedeOlderJobs(row.conversationId, row.id)
    }
    return rows
  } catch (error) {
    // Partial unique ChatAutomationJob_conversation_single_flight_idx
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      if (id) await deferJob(id)
      return []
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/ChatAutomationJob_conversation_single_flight|unique/i.test(message)) {
      if (id) await deferJob(id)
      return []
    }
    throw error
  }
}

export function claimBatch(limit = 2) {
  return claimRows(undefined, Math.max(1, Math.min(limit, 5)))
}

export async function claimJobById(id: string) {
  return (await claimRows(id, 1))[0] || null
}

export async function completeJob(row: ClaimedChatAutomationJob) {
  await prisma.chatAutomationJob.updateMany({
    where: { id: row.id, status: 'processing', leaseToken: row.leaseToken },
    data: {
      status: 'completed',
      payload: Prisma.DbNull,
      processedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  })
}

export async function completeLateJob(row: ClaimedChatAutomationJob) {
  await prisma.chatAutomationJob.updateMany({
    where: { id: row.id, status: 'retry', attempts: row.attempts },
    data: {
      status: 'completed',
      payload: Prisma.DbNull,
      processedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  })
}

export async function failJob(row: ClaimedChatAutomationJob, error: unknown) {
  const nonRetryable =
    error instanceof Error &&
    [
      'SOFT_AI_OUTBOUND_AMBIGUOUS',
      'SOFT_AI_OUTBOUND_CONTENT_CONFLICT',
      'SOFT_AI_PAYLOAD_INVALID',
    ].includes(error.message)
  const ambiguous =
    error instanceof Error && error.message === 'SOFT_AI_OUTBOUND_AMBIGUOUS'
  const terminal = nonRetryable || row.attempts >= MAX_ATTEMPTS
  const timedOut = error instanceof Error && error.name === 'ChatAutomationTimeoutError'

  await prisma.chatAutomationJob.updateMany({
    where: { id: row.id, status: 'processing', leaseToken: row.leaseToken },
    data: {
      status: ambiguous ? 'ambiguous' : terminal ? 'failed' : 'retry',
      availableAt: terminal || ambiguous
        ? new Date()
        : new Date(Date.now() + (timedOut ? 70_000 : retryDelayMs(row.attempts))),
      failedAt: terminal || ambiguous ? new Date() : null,
      payload: terminal || ambiguous ? Prisma.DbNull : undefined,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: safeErrorCode(error),
      lastErrorAt: new Date(),
    },
  })
  return terminal || ambiguous
}

export async function withProcessingTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('CHAT_AUTOMATION_PROCESSING_TIMEOUT')
      error.name = 'ChatAutomationTimeoutError'
      reject(error)
    }, PROCESSING_TIMEOUT_MS)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function purgeExpiredAutomationMetadata() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000)
  return prisma.chatAutomationJob.deleteMany({
    where: {
      status: { in: ['completed', 'failed', 'ambiguous'] },
      payload: { equals: Prisma.DbNull },
      updatedAt: { lt: cutoff },
    },
  })
}
