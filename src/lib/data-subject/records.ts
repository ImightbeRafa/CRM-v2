import 'server-only'
import { prismaRaw } from '@/lib/prisma-tenant'
import { normalizeClientEmail, normalizeClientPhone } from '@/lib/order-lifecycle'

/**
 * Ley 8968: which records belong to ONE customer of ONE business. Shared by export and erasure so
 * both always cover the same data.
 *
 * - Orders: linked by clientId, OR not linked to any customer (legacy / bot orders) but with the
 *   same phone or email. Archived (soft-deleted) orders are included (they still hold the data and
 *   can be restored), so this uses the raw client with explicit tenant predicates.
 * - Chats: linked by clientId, OR a WhatsApp chat not linked to any customer whose number is the
 *   customer's phone.
 * - Messages: in those chats, or linked to the customer and not in any chat.
 * Every query carries the business id; ids are returned sorted (the erasure token binds them).
 */
export type CustomerRecords = {
  clientId: string
  identity: { phone: string | null; email: string | null }
  orders: Array<{ id: string; orderId: string; status: string; updatedAt: Date; deletedAt: Date | null; matchedBy: 'client' | 'phone_or_email' }>
  conversationIds: string[]
}

/** Same normalisation as the Postgres expression below (digits only, Costa Rica 506 prefix dropped). */
export function customerPhoneKey(value: unknown): string | null {
  const phone = normalizeClientPhone(value)
  return phone && phone.length >= 7 ? phone : null
}

export async function findCustomerRecords(tenantId: string, clientId: string): Promise<CustomerRecords | null> {
  if (!tenantId || !clientId) return null
  const client = await prismaRaw.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true, phone: true, email: true, normalizedPhone: true, normalizedEmail: true },
  })
  if (!client) return null
  const phone = customerPhoneKey(client.normalizedPhone || client.phone)
  const email = normalizeClientEmail(client.normalizedEmail || client.email)

  const orders = await prismaRaw.$queryRaw<Array<{
    id: string
    orderId: string
    status: string
    updatedAt: Date
    deletedAt: Date | null
    clientId: string | null
  }>>`
    SELECT o."id", o."orderId", o."status", o."updatedAt", o."deletedAt", o."clientId"
    FROM public."Order" o
    WHERE o."tenantId" = ${tenantId}
      AND (
        o."clientId" = ${clientId}
        OR (
          o."clientId" IS NULL
          AND (
            (${phone}::text IS NOT NULL AND (
              CASE
                WHEN length(regexp_replace(coalesce(o."phone", ''), '\\D', '', 'g')) = 11
                 AND regexp_replace(coalesce(o."phone", ''), '\\D', '', 'g') LIKE '506%'
                THEN substr(regexp_replace(coalesce(o."phone", ''), '\\D', '', 'g'), 4)
                ELSE regexp_replace(coalesce(o."phone", ''), '\\D', '', 'g')
              END
            ) = ${phone})
            OR (${email}::text IS NOT NULL AND lower(trim(coalesce(o."email", ''))) = ${email})
          )
        )
      )
    ORDER BY o."id"
    LIMIT 20001`

  const conversations = await prismaRaw.$queryRaw<Array<{ id: string }>>`
    SELECT c."id"
    FROM public."ChatConversation" c
    JOIN public."SocialAccount" s ON s."id" = c."socialAccountId" AND s."tenantId" = ${tenantId}
    WHERE c."tenantId" = ${tenantId}
      AND (
        c."clientId" = ${clientId}
        OR (
          c."clientId" IS NULL
          AND ${phone}::text IS NOT NULL
          AND lower(s."platform") = 'whatsapp'
          AND (
            CASE
              WHEN length(regexp_replace(c."peerId", '\\D', '', 'g')) = 11
               AND regexp_replace(c."peerId", '\\D', '', 'g') LIKE '506%'
              THEN substr(regexp_replace(c."peerId", '\\D', '', 'g'), 4)
              ELSE regexp_replace(c."peerId", '\\D', '', 'g')
            END
          ) = ${phone}
        )
      )
    ORDER BY c."id"`

  return {
    clientId,
    identity: { phone, email },
    orders: orders.map((o) => ({
      id: o.id,
      orderId: o.orderId,
      status: o.status,
      updatedAt: o.updatedAt,
      deletedAt: o.deletedAt,
      matchedBy: o.clientId === clientId ? 'client' : 'phone_or_email',
    })),
    conversationIds: conversations.map((c) => c.id),
  }
}

/** Messages of this customer: in their chats, or linked to them and in no chat (never by clientId alone). */
export function customerMessageWhere(tenantId: string, clientId: string, conversationIds: string[]) {
  assertIds(tenantId, clientId)
  return {
    tenantId,
    OR: [
      ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : []),
      { clientId, conversationId: null },
    ],
  }
}

/** Notes / tasks / activity / notifications: about the customer or about one of their chats. */
export function customerLinkedWhere(tenantId: string, clientId: string, conversationIds: string[]) {
  assertIds(tenantId, clientId)
  return {
    tenantId,
    OR: [{ clientId }, ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])],
  }
}

/** An undefined / empty id in a Prisma filter matches every row: refuse instead. */
export function assertIds(...ids: Array<string | null | undefined>): void {
  for (const id of ids) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('DATA_SUBJECT_EMPTY_ID')
  }
}
