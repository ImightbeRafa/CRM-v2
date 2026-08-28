import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getBotInboxProcessor } from './processor-registry';

export type BotPlatform = 'whatsapp' | 'telegram';

export interface ClaimedBotInboxMessage {
  id: string;
  tenantId: string;
  platform: BotPlatform;
  providerMessageId: string;
  conversationKey: string;
  payload: unknown;
  attempts: number;
  leaseToken: string;
}

const LEASE_MS = 45_000;
const PROCESSING_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 5;

export function hashBotDeliveryContent(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Persist an outbound chunk claim before calling a provider. Confirmed chunks
 * are skipped on retry. A claim left in `sending`, or any provider-call error,
 * is ambiguous because Meta/Telegram do not accept our idempotency key; fail
 * closed for manual reconciliation instead of risking a duplicate customer
 * message or PDF.
 */
export async function deliverBotOutputOnce<T>(input: {
  inboxMessageId: string;
  deliveryKey: string;
  kind: 'text' | 'document';
  contentHash: string;
  send: () => Promise<T>;
  providerDeliveryId?: (result: T) => string | undefined;
}) {
  let created = false;
  try {
    await prisma.botInboxDelivery.create({
      data: {
        inboxMessageId: input.inboxMessageId,
        deliveryKey: input.deliveryKey,
        kind: input.kind,
        contentHash: input.contentHash,
        status: 'sending',
      },
    });
    created = true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
  }

  if (!created) {
    const existing = await prisma.botInboxDelivery.findUnique({
      where: {
        inboxMessageId_deliveryKey: {
          inboxMessageId: input.inboxMessageId,
          deliveryKey: input.deliveryKey,
        },
      },
      select: { status: true, contentHash: true, providerDeliveryId: true },
    });
    if (!existing || existing.contentHash !== input.contentHash) {
      throw new Error('BOT_OUTBOUND_CONTENT_CONFLICT');
    }
    if (existing.status === 'sent') {
      return { skipped: true, providerDeliveryId: existing.providerDeliveryId || undefined };
    }
    throw new Error('BOT_OUTBOUND_AMBIGUOUS');
  }

  try {
    const result = await input.send();
    const providerDeliveryId = input.providerDeliveryId?.(result);
    await prisma.botInboxDelivery.update({
      where: {
        inboxMessageId_deliveryKey: {
          inboxMessageId: input.inboxMessageId,
          deliveryKey: input.deliveryKey,
        },
      },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerDeliveryId: providerDeliveryId || null,
        lastErrorCode: null,
      },
    });
    return { skipped: false, providerDeliveryId };
  } catch {
    await prisma.botInboxDelivery.updateMany({
      where: {
        inboxMessageId: input.inboxMessageId,
        deliveryKey: input.deliveryKey,
        status: 'sending',
      },
      data: { status: 'ambiguous', lastErrorCode: 'provider_delivery_ambiguous' },
    });
    throw new Error('BOT_OUTBOUND_AMBIGUOUS');
  }
}

export async function persistBotInboxMessage(input: {
  tenantId: string;
  platform: BotPlatform;
  providerMessageId: string;
  conversationKey: string;
  payload: unknown;
}) {
  try {
    const row = await prisma.botInboxMessage.create({
      data: {
        tenantId: input.tenantId,
        platform: input.platform,
        providerMessageId: input.providerMessageId,
        conversationKey: input.conversationKey,
        payload: input.payload as Prisma.InputJsonValue,
      },
      select: { id: true, status: true },
    });
    return { ...row, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.botInboxMessage.findUnique({
        where: {
          platform_providerMessageId: {
            platform: input.platform,
            providerMessageId: input.providerMessageId,
          },
        },
        select: { id: true, status: true },
      });
      if (existing) return { ...existing, duplicate: true };
    }
    throw error;
  }
}

/** Persist one authenticated provider envelope containing several messages as
 * one atomic database operation. Existing provider IDs are left untouched. */
export async function persistBotInboxMessages(inputs: Array<{
  tenantId: string;
  platform: BotPlatform;
  providerMessageId: string;
  conversationKey: string;
  payload: unknown;
}>) {
  const uniqueInputs = Array.from(new Map(
    inputs.map(input => [`${input.platform}:${input.providerMessageId}`, input]),
  ).values());
  if (uniqueInputs.length === 0) return [];

  return prisma.$transaction(async tx => {
    await tx.botInboxMessage.createMany({
      data: uniqueInputs.map(input => ({
        tenantId: input.tenantId,
        platform: input.platform,
        providerMessageId: input.providerMessageId,
        conversationKey: input.conversationKey,
        payload: input.payload as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
    const rows = await tx.botInboxMessage.findMany({
      where: {
        OR: uniqueInputs.map(input => ({
          platform: input.platform,
          providerMessageId: input.providerMessageId,
        })),
      },
      select: { id: true, tenantId: true, platform: true, providerMessageId: true, status: true },
    });
    if (rows.length !== uniqueInputs.length) throw new Error('BOT_INBOX_PERSIST_INCOMPLETE');
    for (const row of rows) {
      const input = uniqueInputs.find(candidate => (
        candidate.platform === row.platform && candidate.providerMessageId === row.providerMessageId
      ));
      if (!input || input.tenantId !== row.tenantId) throw new Error('BOT_INBOX_IDENTITY_CONFLICT');
    }
    return rows;
  });
}

async function claimRows(id?: string, limit = 1): Promise<ClaimedBotInboxMessage[]> {
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
  // The NOT EXISTS clause preserves per-conversation order across serverless
  // instances. SKIP LOCKED lets concurrent claimants work on different chats.
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    tenantId: string;
    platform: BotPlatform;
    providerMessageId: string;
    conversationKey: string;
    payload: unknown;
    attempts: number;
    leaseToken: string;
  }>>(Prisma.sql`
    WITH candidate AS (
      SELECT current."id"
      FROM "BotInboxMessage" current
      WHERE (${id || null}::text IS NULL OR current."id" = ${id || null})
        AND current."payload" IS NOT NULL
        AND current."availableAt" <= CURRENT_TIMESTAMP
        AND EXISTS (
          SELECT 1
          FROM "TenantFeatureFlag" flag
          WHERE flag."tenantId" = current."tenantId"
            AND flag."scope" = current."tenantId"
            AND flag."key" = 'bot_inbox_v2'
            AND flag."enabled" = true
        )
        AND (
          current."status" IN ('pending', 'retry')
          OR (current."status" = 'processing' AND current."leaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "BotInboxMessage" older
          WHERE older."platform" = current."platform"
            AND older."conversationKey" = current."conversationKey"
            AND (older."createdAt", older."id") < (current."createdAt", current."id")
            AND older."status" IN ('pending', 'retry', 'processing')
        )
      ORDER BY current."createdAt" ASC, current."id" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE "BotInboxMessage" message
    SET "status" = 'processing',
        "attempts" = message."attempts" + 1,
        "leaseToken" = ${leaseToken},
        "leaseExpiresAt" = ${leaseExpiresAt},
        "processingStartedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    FROM candidate
    WHERE message."id" = candidate."id"
    RETURNING message."id", message."tenantId", message."platform",
      message."providerMessageId", message."conversationKey", message."payload",
      message."attempts", message."leaseToken"
  `);
  return rows;
}

export function claimBotInboxBatch(limit = 2) {
  return claimRows(undefined, Math.max(1, Math.min(limit, 5)));
}

export async function claimBotInboxMessage(id: string) {
  return (await claimRows(id, 1))[0] || null;
}

async function completeBotInboxMessage(row: ClaimedBotInboxMessage) {
  await prisma.botInboxMessage.updateMany({
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
  });
}

function retryDelayMs(attempts: number) {
  return Math.min(15 * 60_000, 5_000 * (2 ** Math.max(0, attempts - 1)));
}

function safeErrorCode(error: unknown) {
  if (error instanceof Error && error.name === 'BotInboxTimeoutError') return 'processing_timeout';
  if (error instanceof Error && /^[A-Z0-9_:-]{3,80}$/.test(error.message)) return error.message.slice(0, 80);
  return 'processing_failed';
}

async function failBotInboxMessage(row: ClaimedBotInboxMessage, error: unknown) {
  const nonRetryable = error instanceof Error && [
    'WHATSAPP_PAYLOAD_INVALID', 'TELEGRAM_PAYLOAD_INVALID',
    'TELEGRAM_UPDATE_UNSUPPORTED', 'BOT_SESSION_TENANT_CHANGED',
    'BOT_SESSION_INACTIVE', 'BOT_OUTBOUND_AMBIGUOUS',
    'BOT_OUTBOUND_CONTENT_CONFLICT',
  ].includes(error.message);
  const terminal = nonRetryable || row.attempts >= MAX_ATTEMPTS;
  const timedOut = error instanceof Error && error.name === 'BotInboxTimeoutError';
  await prisma.botInboxMessage.updateMany({
    where: { id: row.id, status: 'processing', leaseToken: row.leaseToken },
    data: {
      status: terminal ? 'failed' : 'retry',
      availableAt: terminal
        ? new Date()
        : new Date(Date.now() + (timedOut ? 70_000 : retryDelayMs(row.attempts))),
      failedAt: terminal ? new Date() : null,
      payload: terminal ? Prisma.DbNull : undefined,
      leaseToken: null,
      leaseExpiresAt: null,
      lastErrorCode: safeErrorCode(error),
      lastErrorAt: new Date(),
    },
  });
  return terminal;
}

async function completeLateBotInboxMessage(row: ClaimedBotInboxMessage) {
  await prisma.botInboxMessage.updateMany({
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
  });
}

async function withProcessingTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('BOT_INBOX_PROCESSING_TIMEOUT');
      error.name = 'BotInboxTimeoutError';
      reject(error);
    }, PROCESSING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function dispatch(row: ClaimedBotInboxMessage) {
  if (row.platform === 'whatsapp') {
    await import('@/app/api/bot/whatsapp/webhook/route');
  } else {
    await import('@/app/api/bot/telegram/webhook/route');
  }
  return getBotInboxProcessor(row.platform)(row.payload, {
    inboxMessageId: row.id,
    providerMessageId: row.providerMessageId,
    tenantId: row.tenantId,
  });
}

export async function processClaimedBotInboxMessage(row: ClaimedBotInboxMessage) {
  const work = dispatch(row);
  try {
    await withProcessingTimeout(work);
    await completeBotInboxMessage(row);
    return { id: row.id, status: 'completed' as const };
  } catch (error) {
    const terminal = await failBotInboxMessage(row, error);
    if (error instanceof Error && error.name === 'BotInboxTimeoutError') {
      // If the serverless invocation remains alive and the timed-out work
      // finishes before the delayed retry, close the row instead of sending a
      // duplicate response. If Vercel kills it, the cron retry remains valid.
      void work.then(
        () => completeLateBotInboxMessage(row),
        () => undefined,
      );
    }
    return { id: row.id, status: terminal ? 'failed' as const : 'retry' as const };
  }
}

export async function processBotInboxMessageById(id: string) {
  const row = await claimBotInboxMessage(id);
  if (!row) return { id, status: 'not_claimed' as const };
  return processClaimedBotInboxMessage(row);
}

export async function purgeExpiredBotInboxMetadata() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  return prisma.botInboxMessage.deleteMany({
    where: {
      status: { in: ['completed', 'failed'] },
      payload: { equals: Prisma.DbNull },
      updatedAt: { lt: cutoff },
    },
  });
}
