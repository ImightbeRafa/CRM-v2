/**
 * Live turn only: the newest collected order linked from this chat, and whether
 * the message that just arrived is a copy of a receipt already on that order.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { derivePaymentState } from '@/lib/order-payment-status'
import {
  isDuplicateReceipt,
  paymentFingerprint,
  pickSettledSale,
  type ReceiptProbe,
} from '@/lib/soft-ai/repeat-order'

export type LoadedSettledSale = {
  orderNumber: string
  settledAt: string
  duplicateReceipt: boolean
}

export async function loadSettledSale(input: {
  tenantId: string
  conversationId: string
  trigger: ReceiptProbe
}): Promise<LoadedSettledSale | null> {
  try {
    const links = await prisma.chatMessage.findMany({
      where: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        orderId: { not: null },
        order: { tenantId: input.tenantId, deletedAt: null },
      },
      orderBy: { sentAt: 'desc' },
      take: 40,
      select: {
        sentAt: true,
        order: {
          select: {
            orderId: true,
            status: true,
            contraEntrega: true,
            cePaymentConfirmed: true,
            customFields: true,
          },
        },
      },
    })
    const settled = pickSettledSale(
      links.flatMap((link) => {
        if (!link.order) return []
        return [
          {
            sentAt: link.sentAt.toISOString(),
            orderNumber: link.order.orderId,
            collected: derivePaymentState(link.order).collected,
          },
        ]
      }),
    )
    if (!settled) return null
    const settledAt = new Date(settled.settledAt)
    const prior = await prisma.chatMessage.findMany({
      where: {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        direction: 'inbound',
        sentAt: { lte: settledAt },
      },
      orderBy: { sentAt: 'desc' },
      take: 80,
      select: { providerMediaId: true, mediaBlobPath: true, content: true },
    })
    const mediaKeys: string[] = []
    const fingerprints: string[] = []
    for (const row of prior) {
      if (row.providerMediaId) mediaKeys.push(row.providerMediaId)
      if (row.mediaBlobPath) mediaKeys.push(row.mediaBlobPath)
      const fingerprint = paymentFingerprint(row.content)
      if (fingerprint) fingerprints.push(fingerprint)
    }
    return {
      orderNumber: settled.orderNumber,
      settledAt: settled.settledAt,
      duplicateReceipt: isDuplicateReceipt(input.trigger, { mediaKeys, fingerprints }),
    }
  } catch (error) {
    console.error('[soft-ai] settled sale', { code: error instanceof Error ? error.name : 'error' })
    return null
  }
}
