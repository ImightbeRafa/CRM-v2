/**
 * Soft AI durable automation queue — lease/claim/retry.
 * Copies BotInboxMessage algorithms; shares no bot tables or imports.
 */

import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export const SOFT_AI_JOB_KIND = 'soft_ai_inbound' as const
export const LEASE_MS = 45_000
// Must cover the whole agent turn (SOFT_AI_TURN_BUDGET_MS 35 s) + the Meta send (7 s), and stay under the 45 s lease.
export const PROCESSING_TIMEOUT_MS = 42_000
export const MAX_ATTEMPTS = 5
/**
 * Burst = one reply (2026-10-17, PatchHouse IG): a customer often sends 2–3 messages within seconds (an ad share +
 * "¡Hola! Quiero más información."). Each inbound job waits this long before it may be claimed, so the newest job of
 * the burst answers all of it and the older ones are superseded at claim (no double greeting).
 */
export const BURST_SETTLE_MS = 3_500
/** A newer job of the same chat that becomes claimable within this horizon holds the older ones back (claim SQL). */
export const BURST_HOLD_SECONDS = 10
/** Newest first as the claim SQL sees it: by the customer message's sentAt, then createdAt / id. */
export const NEWEST_BURST_JOB_ORDER = [
  { message: { sentAt: 'desc' } },
  { createdAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.ChatAutomationJobOrderByWithRelationInput[]

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
  /** Not claimable before this time (inbound bursts: now + BURST_SETTLE_MS). Default: now. */
  availableAt?: Date
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
        ...(input.availableAt ? { availableAt: input.availableAt } : {}),
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

/**
 * "Never left waiting" (Agentes IA 2.0 · C): put a finished job for the SAME customer message back in
 * the queue, keeping its delivery key, so a chat that was skipped (line off, chat with a person, budget)
 * gets answered once the reason is gone. Safe by construction:
 * - only a job of THIS tenant that is `completed` / `failed` (never pending, processing or ambiguous);
 * - only when the job never created any outbound delivery claim (nothing was ever sent for it);
 * - one conditional UPDATE, so a concurrent claim or delivery makes it a no-op (count 0).
 * The claim gates still skip it if a person replies before it runs.
 */
export async function rearmFinishedJob(input: {
  id: string
  tenantId: string
  payload: Record<string, unknown>
}): Promise<boolean> {
  const res = await prisma.chatAutomationJob.updateMany({
    where: {
      id: input.id,
      tenantId: input.tenantId,
      status: { in: ['completed', 'failed'] },
      // luna-10: the waiting ack ("Ya le avisé al equipo…") is not an answer to this message.
      deliveries: { none: { NOT: { deliveryKey: { endsWith: ':waiting_ack' } } } },
    },
    data: {
      status: 'pending',
      availableAt: new Date(),
      payload: input.payload as Prisma.InputJsonValue,
      processedAt: null,
      failedAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  })
  return res.count === 1
}

/**
 * Burst = one reply: is there a newer customer-message job in this chat that will answer the whole burst? Only a
 * pending / retry job created after this one (same tenant and chat). Checked before the model runs and again right
 * before the send: this job then stops as superseded and the newer one answers everything.
 */
export async function newerBurstJobPending(
  row: Pick<ClaimedChatAutomationJob, 'id' | 'tenantId' | 'conversationId'>,
  /** SecureDog R1: only a message SENT no earlier than this trigger counts (not an old one Meta delivered late). */
  triggerSentAt?: Date,
): Promise<boolean> {
  const self = await prisma.chatAutomationJob.findFirst({
    where: { id: row.id, tenantId: row.tenantId },
    select: { createdAt: true },
  })
  if (!self) return false
  const newer = await prisma.chatAutomationJob.findFirst({
    where: {
      tenantId: row.tenantId,
      conversationId: row.conversationId,
      id: { not: row.id },
      kind: SOFT_AI_JOB_KIND,
      status: { in: ['pending', 'retry'] },
      createdAt: { gt: self.createdAt },
      ...(triggerSentAt ? { message: { sentAt: { gte: triggerSentAt } } } : {}),
    },
    select: { id: true },
  })
  return Boolean(newer)
}

/**
 * The claimed job answers the burst, so its siblings are done. Except a job whose customer message already has a store
 * reply after it (Meta delivered it late, after the reply went out): that message is not in the claimed job's burst
 * (the burst starts after the last reply), so the job stays queued and runs on its own afterwards — its opt-out /
 * "hablar con una persona" / receipt is still checked (SecureDog F1: superseded = checked).
 */
async function supersedeOlderJobs(conversationId: string, keepId: string) {
  await prisma.$executeRaw`
    UPDATE "ChatAutomationJob" job
    SET "status" = 'completed',
        "lastErrorCode" = 'SUPERSEDED',
        "processedAt" = CURRENT_TIMESTAMP,
        "payload" = NULL,
        "leaseToken" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE job."conversationId" = ${conversationId}
      AND job."id" <> ${keepId}
      AND job."status" IN ('pending', 'retry')
      AND NOT EXISTS (
        SELECT 1
        FROM "ChatMessage" msg
        JOIN "ChatMessage" reply
          ON reply."conversationId" = msg."conversationId"
         AND reply."tenantId" = msg."tenantId"
         AND reply."direction" = 'outbound'
         AND (reply."sentAt", reply."id") > (msg."sentAt", msg."id")
        WHERE msg."id" = job."messageId"
      )
  `
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
  // Burst = one reply: a newer job still settling (claimable within BURST_HOLD_SECONDS) also holds the older ones
  // back, so the first bubble of a burst is not answered alone while the next one is seconds away.
  // "Newer" is by the customer message's sentAt, then createdAt / id (burst hardening): a bubble Meta delivers late
  // (sent earlier, job created later) never becomes the answering job; it is one of the burst's other bubbles. The
  // message is joined, never locked (FOR UPDATE OF current): ChatAutomationJob.messageId is a required FK (cascade).
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
        JOIN "ChatMessage" current_msg ON current_msg."id" = current."messageId"
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
            JOIN "ChatMessage" newer_msg ON newer_msg."id" = newer."messageId"
            WHERE newer."conversationId" = current."conversationId"
              AND (newer_msg."sentAt", newer."createdAt", newer."id") > (current_msg."sentAt", current."createdAt", current."id")
              AND newer."status" IN ('pending', 'retry')
              AND (
                newer."availableAt" <= CURRENT_TIMESTAMP + ${Prisma.raw(`INTERVAL '${BURST_HOLD_SECONDS} seconds'`)}
                -- A job kept by supersedeOlderJobs (its message already has a store reply after it) waits for every
                -- newer job, also one on a long retry, so it never supersedes the burst's answering job (Verifier r3).
                OR EXISTS (
                  SELECT 1
                  FROM "ChatMessage" reply
                  WHERE reply."conversationId" = current_msg."conversationId"
                    AND reply."tenantId" = current_msg."tenantId"
                    AND reply."direction" = 'outbound'
                    AND (reply."sentAt", reply."id") > (current_msg."sentAt", current_msg."id")
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "ChatAutomationJob" inflight
            WHERE inflight."conversationId" = current."conversationId"
              AND inflight."status" = 'processing'
              AND inflight."leaseExpiresAt" > CURRENT_TIMESTAMP
              AND inflight."id" <> current."id"
          )
        ORDER BY current_msg."sentAt" DESC, current."createdAt" DESC, current."id" DESC
        FOR UPDATE OF current SKIP LOCKED
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
