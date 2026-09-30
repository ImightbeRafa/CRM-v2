import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { CHAT_MEDIA_BLOB_PREFIX, deleteChatBlobs } from '@/lib/chat-media'
import { normalizeStoredStatus } from '@/lib/cursor-pagination'

/**
 * Ley 8968 (Costa Rica) erasure of ONE customer of ONE business. Decisions (Rafael, 2026-09-30):
 * - Personal data is blanked on the customer and their orders; chats and CRM notes about them go.
 * - Invoices are KEPT as they are (tax records).
 * - Logistics (`lm_*`, DeepSleep in-house) and shipping labels are NEVER touched.
 * - Orders still in progress block the erasure (the delivery would lose its address).
 * Every query carries the business id; the same request twice changes nothing more.
 */
export const ERASED_NAME = 'Cliente eliminado'
const OPEN_ORDER_WINDOW_DAYS = 60
const TOKEN_TTL_MS = 10 * 60_000

export type ErasureScope = {
  clientId: string
  orderIds: string[]
  conversationIds: string[]
  counts: { orders: number; conversations: number; messages: number; notes: number; tasks: number }
  openOrders: string[] // human order numbers still in progress (block the erasure)
}

async function terminalStatuses(tenantId: string): Promise<Set<string>> {
  const rows = await prisma.tenantOrderStatusClassification.findMany({
    where: { tenantId, isTerminal: true },
    select: { statusValue: true, normalizedStatusValue: true },
  })
  return new Set(rows.flatMap((r) => [normalizeStoredStatus(r.statusValue), normalizeStoredStatus(r.normalizedStatusValue)]))
}

/** Ids and counts only (no personal data). Null when the customer is not in this business. */
export async function resolveErasureScope(tenantId: string, clientId: string, now = Date.now()): Promise<ErasureScope | null> {
  if (!tenantId || !clientId) return null
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } })
  if (!client) return null
  const [orders, conversations, terminal] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, clientId },
      select: { id: true, orderId: true, status: true, timestamp: true, deletedAt: true },
    }),
    prisma.chatConversation.findMany({ where: { tenantId, clientId }, select: { id: true } }),
    terminalStatuses(tenantId),
  ])
  const conversationIds = conversations.map((c) => c.id).sort()
  const linkedTo = [{ clientId }, ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])]
  const [messages, notes, tasks] = await Promise.all([
    prisma.chatMessage.count({ where: { tenantId, OR: linkedTo } }),
    prisma.crmNote.count({ where: { tenantId, OR: linkedTo } }),
    prisma.crmTask.count({ where: { tenantId, OR: linkedTo } }),
  ])
  const recent = now - OPEN_ORDER_WINDOW_DAYS * 24 * 60 * 60_000
  const openOrders = orders
    .filter((o) => !o.deletedAt && o.timestamp.getTime() >= recent && !terminal.has(normalizeStoredStatus(o.status)))
    .map((o) => o.orderId)
  return {
    clientId,
    orderIds: orders.map((o) => o.id).sort(),
    conversationIds,
    counts: { orders: orders.length, conversations: conversationIds.length, messages, notes, tasks },
    openOrders,
  }
}

function tokenKey(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET missing')
  return secret
}

/** Binds the confirmation to exactly what the owner saw (same ids), for 10 minutes. */
export function erasureConfirmToken(tenantId: string, scope: ErasureScope, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS
  const body = [tenantId, scope.clientId, scope.orderIds.join(','), scope.conversationIds.join(','), exp].join('|')
  const mac = createHmac('sha256', tokenKey()).update(`dsr-erase:${body}`).digest('base64url')
  return `${exp}.${mac}`
}

export function verifyErasureConfirmToken(tenantId: string, scope: ErasureScope, token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string') return false
  const [expRaw, mac] = token.split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now || !mac) return false
  const body = [tenantId, scope.clientId, scope.orderIds.join(','), scope.conversationIds.join(','), exp].join('|')
  const expected = createHmac('sha256', tokenKey()).update(`dsr-erase:${body}`).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type ErasureResult = { counts: Record<string, number>; mediaFilesRemoved: number; mediaFilesFailed: number }

/**
 * Blanks / deletes in ONE transaction; chat files are removed after it commits (only paths inside
 * this business's own chat folder: message metadata comes from webhooks and is never trusted).
 */
export async function eraseCustomerData(tenantId: string, scope: ErasureScope): Promise<ErasureResult> {
  const { clientId, orderIds, conversationIds } = scope
  const linkedTo = [{ clientId }, ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])]
  const mediaPrefix = `${CHAT_MEDIA_BLOB_PREFIX}/${tenantId}/`

  const mediaRows = await prisma.chatMessage.findMany({
    where: { tenantId, OR: linkedTo, mediaBlobPath: { not: null } },
    select: { mediaBlobPath: true },
  })
  const mediaPaths = [...new Set(mediaRows.map((m) => m.mediaBlobPath as string))].filter(
    (p) => p.startsWith(mediaPrefix) && !p.includes('..'),
  )

  const counts = await prisma.$transaction(
    async (tx) => {
      const out: Record<string, number> = {}
      out.client = (
        await tx.client.updateMany({
          where: { id: clientId, tenantId },
          data: {
            name: ERASED_NAME,
            phone: '',
            email: null,
            normalizedPhone: null,
            normalizedEmail: null,
            province: '',
            canton: '',
            district: '',
            address: null,
            business: null,
            username: null,
            notes: null,
            isActive: false,
            isFavorite: false,
          },
        })
      ).count
      out.orders = orderIds.length
        ? (
            await tx.order.updateMany({
              where: { tenantId, id: { in: orderIds } },
              data: {
                customerName: ERASED_NAME,
                username: null,
                phone: null,
                email: null,
                business: null,
                address: null,
                canton: null,
                district: null,
                comments: null,
                customization: null,
                customFields: Prisma.DbNull,
              },
            })
          ).count
        : 0
      // Chat: messages first (their conversation link is SET NULL, not cascade), then the chats.
      out.messages = (await tx.chatMessage.deleteMany({ where: { tenantId, OR: linkedTo } })).count
      if (conversationIds.length) {
        await tx.chatConversationWorkState.deleteMany({ where: { tenantId, conversationId: { in: conversationIds } } })
        out.conversations = (await tx.chatConversation.deleteMany({ where: { tenantId, id: { in: conversationIds } } })).count
      } else {
        out.conversations = 0
      }
      out.notes = (await tx.crmNote.deleteMany({ where: { tenantId, OR: linkedTo } })).count
      out.tasks = (await tx.crmTask.deleteMany({ where: { tenantId, OR: linkedTo } })).count
      await tx.clientLifecycleState.deleteMany({ where: { tenantId, clientId } })
      out.activity = (await tx.activityEvent.deleteMany({ where: { tenantId, OR: linkedTo } })).count
      if (orderIds.length) {
        // Order history stays (ids / status), without any free-form details about the person.
        await tx.activityEvent.updateMany({ where: { tenantId, orderId: { in: orderIds } }, data: { props: {} } })
        await tx.clientIdentityConflict.deleteMany({ where: { tenantId, orderId: { in: orderIds } } })
      }
      // Audit trail keeps WHAT happened, not the personal values.
      await tx.auditLog.updateMany({
        where: {
          tenantId,
          OR: [
            { entityType: 'Client', entityId: clientId },
            ...(orderIds.length ? [{ entityType: 'Order', entityId: { in: orderIds } }] : []),
          ],
        },
        data: { entityName: null, oldValues: { redacted: 'ley8968' }, newValues: { redacted: 'ley8968' } },
      })
      return out
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  let mediaFilesRemoved = 0
  let mediaFilesFailed = 0
  for (let i = 0; i < mediaPaths.length; i += 100) {
    const batch = mediaPaths.slice(i, i + 100)
    try {
      await deleteChatBlobs(batch)
      mediaFilesRemoved += batch.length
    } catch {
      mediaFilesFailed += batch.length
    }
  }
  return { counts, mediaFilesRemoved, mediaFilesFailed }
}
