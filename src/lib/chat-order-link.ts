import { z } from 'zod'

/**
 * Link a CRM order to the chat it came from by setting `ChatMessage.orderId` (existing FK).
 * Pure helpers used by `POST /api/chat/order-link` and its tests.
 */
const refString = z.string().trim().min(1).max(200)

export const orderLinkBodySchema = z.object({
  socialAccountId: refString,
  peerId: refString,
  /** `Order.id` (cuid) or the public `Order.orderId`. */
  order: refString,
})

export type OrderLinkBody = z.infer<typeof orderLinkBodySchema>

export function parseOrderLinkBody(json: unknown): OrderLinkBody | null {
  const parsed = orderLinkBodySchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export interface LinkableMessage {
  id: string
  direction: string
  orderId: string | null
}

/**
 * Message that will carry the link. `messages` must be newest-first.
 * Prefers the latest inbound message with no order, then any message with no order.
 */
export function pickLinkTarget<T extends LinkableMessage>(messages: T[]): T | null {
  const unlinked = messages.filter((m) => !m.orderId)
  return unlinked.find((m) => m.direction === 'inbound') ?? unlinked[0] ?? null
}

/** True when some message of the thread already points at this order. */
export function isAlreadyLinked(messages: LinkableMessage[], orderDbId: string): boolean {
  return messages.some((m) => m.orderId === orderDbId)
}
