/**
 * Soft AI exactly-once outbound delivery claims.
 * Copies BotInboxDelivery algorithms; shares no bot tables or imports.
 *
 * State machine: ready → sending → sent
 * Unclear provider outcome → ambiguous (never auto-resend sent/ambiguous).
 */

import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export function hashSoftAiDeliveryContent(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Persist an outbound claim before calling Meta. Confirmed chunks are skipped
 * on retry. A claim left in `sending`, or any provider-call error, is
 * ambiguous because Meta does not accept our idempotency key — fail closed
 * instead of risking a duplicate customer message.
 */
export async function deliverOnce<T>(input: {
  jobId: string
  deliveryKey: string
  kind: 'text'
  contentHash: string
  send: () => Promise<T>
  providerDeliveryId?: (result: T) => string | undefined
}) {
  let created = false
  try {
    await prisma.chatAutomationDelivery.create({
      data: {
        jobId: input.jobId,
        deliveryKey: input.deliveryKey,
        kind: input.kind,
        contentHash: input.contentHash,
        status: 'ready',
      },
    })
    created = true
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error
    }
  }

  if (!created) {
    const existing = await prisma.chatAutomationDelivery.findUnique({
      where: {
        jobId_deliveryKey: {
          jobId: input.jobId,
          deliveryKey: input.deliveryKey,
        },
      },
      select: { status: true, contentHash: true, providerDeliveryId: true },
    })
    if (!existing || existing.contentHash !== input.contentHash) {
      throw new Error('SOFT_AI_OUTBOUND_CONTENT_CONFLICT')
    }
    if (existing.status === 'sent') {
      return {
        skipped: true as const,
        providerDeliveryId: existing.providerDeliveryId || undefined,
      }
    }
    // ready / sending / ambiguous — never auto-resend
    throw new Error('SOFT_AI_OUTBOUND_AMBIGUOUS')
  }

  const claimed = await prisma.chatAutomationDelivery.updateMany({
    where: {
      jobId: input.jobId,
      deliveryKey: input.deliveryKey,
      status: 'ready',
    },
    data: { status: 'sending', updatedAt: new Date() },
  })
  if (claimed.count !== 1) {
    throw new Error('SOFT_AI_OUTBOUND_AMBIGUOUS')
  }

  try {
    const result = await input.send()
    const providerDeliveryId = input.providerDeliveryId?.(result)
    await prisma.chatAutomationDelivery.update({
      where: {
        jobId_deliveryKey: {
          jobId: input.jobId,
          deliveryKey: input.deliveryKey,
        },
      },
      data: {
        status: 'sent',
        sentAt: new Date(),
        providerDeliveryId: providerDeliveryId || null,
        lastErrorCode: null,
      },
    })
    return { skipped: false as const, providerDeliveryId, result }
  } catch {
    await prisma.chatAutomationDelivery.updateMany({
      where: {
        jobId: input.jobId,
        deliveryKey: input.deliveryKey,
        status: 'sending',
      },
      data: { status: 'ambiguous', lastErrorCode: 'provider_delivery_ambiguous' },
    })
    throw new Error('SOFT_AI_OUTBOUND_AMBIGUOUS')
  }
}
