import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isMissingTable } from '@/lib/meta-attribution/referral-store'
import { ATTRIBUTION_WINDOW_DAYS, eventValue, isPaymentConfirmed, tenantCurrency } from '@/lib/meta-attribution/payment'
import { purchaseEventId } from '@/lib/meta-attribution/capi-payload'

/**
 * Finds paid orders that came from an ad chat and queues ONE Purchase event per order.
 * Runs per business that turned the feature on; every query carries that business id. Touches
 * no order write path: it only reads orders (linked to a chat through ChatMessage.orderId, the
 * same link the inbox shows) and inserts into the outbox (unique per business + order).
 *
 * Eligible when ALL hold: the order was created in the last 7 days and is not archived /
 * cancelled, payment is CONFIRMED (cash on delivery confirmed, or explicitly paid), the chat has an
 * ad click id from BEFORE the order (at most 7 days before it), the line is WhatsApp and has a
 * ready dataset, and the business currency is colones or dollars. The event time is the order
 * time (an old purchase is never credited to a newer click — SecureDog M5).
 */
const MAX_ORDERS_PER_TENANT = 500

type Candidate = {
  id: string
  timestamp: Date
  total: number
  status: string
  contraEntrega: boolean
  cePaymentConfirmed: boolean
  customFields: unknown
  deletedAt: Date | null
  conversationId: string
  socialAccountId: string
  platform: string
}

export type SweepResult = { tenantId: string; candidates: number; queued: number; skipped: Record<string, number> }

export async function sweepTenant(tenantId: string, now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { tenantId, candidates: 0, queued: 0, skipped: {} }
  const skip = (why: string) => {
    result.skipped[why] = (result.skipped[why] ?? 0) + 1
  }
  if (!tenantId) return result

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  const currency = tenantCurrency(tenant?.settings)
  if (!currency) {
    skip('currency_not_supported')
    return result
  }
  const since = new Date(now.getTime() - ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60_000)
  const windowMs = ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60_000

  // Nothing to do until at least one line can actually send (avoids queueing rows that would wait).
  const ready = await prisma.metaCapiDataset.count({ where: { tenantId, status: 'ready' } }).catch(() => 0)
  if (ready === 0) {
    skip('no_ready_line')
    return result
  }

  let rows: Candidate[]
  try {
    rows = await prisma.$queryRaw<Candidate[]>`
      SELECT o."id", o."timestamp", o."total", o."status", o."contraEntrega", o."cePaymentConfirmed", o."customFields", o."deletedAt",
             link."conversationId", c."socialAccountId", s."platform"
      FROM public."Order" o
      JOIN LATERAL (
        SELECT cm."conversationId"
        FROM public."ChatMessage" cm
        WHERE cm."tenantId" = ${tenantId} AND cm."orderId" = o."id" AND cm."conversationId" IS NOT NULL
        ORDER BY cm."sentAt" DESC
        LIMIT 1
      ) link ON TRUE
      JOIN public."ChatConversation" c ON c."id" = link."conversationId" AND c."tenantId" = ${tenantId}
      JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
      WHERE o."tenantId" = ${tenantId}
        AND o."deletedAt" IS NULL
        AND o."timestamp" >= ${since}
        AND EXISTS (
          SELECT 1 FROM public."ChatAdReferral" r
          WHERE r."tenantId" = ${tenantId} AND r."conversationId" = link."conversationId"
            AND r."ctwaClid" IS NOT NULL
            AND r."occurredAt" <= o."timestamp"
            AND r."occurredAt" >= o."timestamp" - interval '7 days'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public."MetaConversionEvent" e
          WHERE e."tenantId" = ${tenantId} AND e."orderId" = o."id"
        )
      ORDER BY o."timestamp" DESC
      LIMIT ${MAX_ORDERS_PER_TENANT}`
  } catch (error) {
    if (isMissingTable(error)) {
      skip('tables_missing')
      return result
    }
    throw error
  }
  result.candidates = rows.length

  for (const o of rows) {
    if (String(o.platform).toLowerCase() !== 'whatsapp') {
      skip('not_whatsapp')
      continue
    }
    if (!isPaymentConfirmed(o)) {
      skip('payment_not_confirmed')
      continue
    }
    const value = eventValue(o.total, currency)
    if (value === null) {
      skip('no_amount')
      continue
    }
    const orderAt = new Date(o.timestamp)
    const referral = await prisma.chatAdReferral.findFirst({
      where: {
        tenantId,
        conversationId: o.conversationId,
        ctwaClid: { not: null },
        occurredAt: { gte: new Date(orderAt.getTime() - windowMs), lte: orderAt },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    })
    if (!referral) {
      skip('click_outside_window')
      continue
    }
    const inserted = await prisma.$executeRaw`
      INSERT INTO public."MetaConversionEvent" (
        "id", "tenantId", "socialAccountId", "conversationId", "orderId", "referralId",
        "eventName", "eventId", "eventTime", "value", "currency", "channel", "status", "availableAt"
      ) VALUES (
        ${randomUUID()}, ${tenantId}, ${o.socialAccountId}, ${o.conversationId}, ${o.id}, ${referral.id},
        'Purchase', ${purchaseEventId(o.id)}, ${orderAt}, ${value}, ${currency}, 'whatsapp', 'pending', ${now}
      )
      ON CONFLICT ("tenantId", "eventId") DO NOTHING`
    if (inserted > 0) result.queued += 1
    else skip('already_queued')
  }
  return result
}
