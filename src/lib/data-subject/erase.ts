import 'server-only'
import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { Prisma } from '@prisma/client'
import { prismaRaw } from '@/lib/prisma-tenant'
import { CHAT_MEDIA_BLOB_PREFIX, deleteChatBlobs } from '@/lib/chat-media'
import { normalizeStoredStatus } from '@/lib/cursor-pagination'
import { entityTypeFilterAliases } from '@/lib/auditPayload'
import {
  assertIds,
  customerLinkedWhere,
  customerMessageWhere,
  findCustomerRecords,
  type CustomerRecords,
} from '@/lib/data-subject/records'
import { suppressionHash } from '@/lib/data-subject/suppression'

/**
 * Ley 8968 (Costa Rica) erasure of ONE customer of ONE business. Decisions (Rafael, 2026-09-30):
 * - Personal data is blanked on the customer and their orders (incl. archived orders and orders
 *   matched by phone / email that were never linked); chats, notes, tasks and alerts about them go.
 * - Invoices are KEPT as they are (tax records).
 * - Logistics (`lm_*`, DeepSleep in-house) and shipping labels are NEVER touched.
 * - Orders still in progress block the erasure (the delivery would lose its address), unless the
 *   owner confirms they are finished.
 * - The customer's WhatsApp number goes on a "do not re-import" list (history sync).
 * Every query carries the business id; the same request twice changes nothing more.
 */
export const ERASED_NAME = 'Cliente eliminado'
const OPEN_ORDER_WINDOW_DAYS = 60
const TOKEN_TTL_MS = 10 * 60_000

/** Used when a business never classified its statuses (normalised names). */
const FALLBACK_TERMINAL = [
  'entregado', 'entregada', 'completado', 'completada', 'finalizado', 'finalizada', 'cancelado', 'cancelada',
  'anulado', 'anulada', 'devuelto', 'devuelta', 'retirado', 'retirada', 'cerrado', 'cerrada',
]

export type ErasureScope = {
  clientId: string
  orderIds: string[]
  conversationIds: string[]
  counts: {
    orders: number
    ordersMatchedByContact: number
    archivedOrders: number
    conversations: number
    messages: number
    notes: number
    tasks: number
  }
  /** Human order numbers that look in progress (block unless the owner confirms they are finished). */
  openOrders: string[]
  phone: string | null
}

async function terminalStatuses(tenantId: string): Promise<Set<string>> {
  const rows = await prismaRaw.tenantOrderStatusClassification.findMany({
    where: { tenantId, isTerminal: true },
    select: { statusValue: true, normalizedStatusValue: true },
  })
  if (rows.length === 0) return new Set(FALLBACK_TERMINAL.map((s) => normalizeStoredStatus(s)))
  return new Set(rows.flatMap((r) => [normalizeStoredStatus(r.statusValue), normalizeStoredStatus(r.normalizedStatusValue)]))
}

/** "In progress" = not archived, touched in the last 60 days, and not in a finished status. */
export function openOrderNumbers(records: Pick<CustomerRecords, 'orders'>, terminal: Set<string>, now: number): string[] {
  const recent = now - OPEN_ORDER_WINDOW_DAYS * 24 * 60 * 60_000
  return records.orders
    .filter((o) => !o.deletedAt && o.updatedAt.getTime() >= recent && !terminal.has(normalizeStoredStatus(o.status)))
    .map((o) => o.orderId)
    .sort()
}

/** Ids and counts only (no personal data). Null when the customer is not in this business. */
export async function resolveErasureScope(tenantId: string, clientId: string, now = Date.now()): Promise<ErasureScope | null> {
  if (!tenantId || !clientId) return null
  const records = await findCustomerRecords(tenantId, clientId)
  if (!records) return null
  const { conversationIds } = records
  const [messages, notes, tasks, terminal] = await Promise.all([
    prismaRaw.chatMessage.count({ where: customerMessageWhere(tenantId, clientId, conversationIds) }),
    prismaRaw.crmNote.count({ where: customerLinkedWhere(tenantId, clientId, conversationIds) }),
    prismaRaw.crmTask.count({ where: customerLinkedWhere(tenantId, clientId, conversationIds) }),
    terminalStatuses(tenantId),
  ])
  return {
    clientId,
    orderIds: records.orders.map((o) => o.id).sort(),
    conversationIds,
    counts: {
      orders: records.orders.length,
      ordersMatchedByContact: records.orders.filter((o) => o.matchedBy === 'phone_or_email').length,
      archivedOrders: records.orders.filter((o) => o.deletedAt).length,
      conversations: conversationIds.length,
      messages,
      notes,
      tasks,
    },
    openOrders: openOrderNumbers(records, terminal, now),
    phone: records.identity.phone,
  }
}

function tokenKey(): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET missing')
  return secret
}

function tokenBody(tenantId: string, scope: ErasureScope, exp: number): string {
  return [tenantId, scope.clientId, scope.orderIds.join(','), scope.conversationIds.join(','), scope.openOrders.join(','), exp].join('|')
}

/** Binds the confirmation to exactly what the owner saw (same ids, same open orders), for 10 minutes. */
export function erasureConfirmToken(tenantId: string, scope: ErasureScope, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS
  const mac = createHmac('sha256', tokenKey()).update(`dsr-erase:${tokenBody(tenantId, scope, exp)}`).digest('base64url')
  return `${exp}.${mac}`
}

export function verifyErasureConfirmToken(tenantId: string, scope: ErasureScope, token: unknown, now = Date.now()): boolean {
  if (typeof token !== 'string') return false
  const [expRaw, mac] = token.split('.')
  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp < now || !mac) return false
  const expected = createHmac('sha256', tokenKey()).update(`dsr-erase:${tokenBody(tenantId, scope, exp)}`).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type ErasureResult = { counts: Record<string, number>; mediaFilesRemoved: number; mediaFilesFailed: number }

export type ErasureAudit = {
  userId: string | null
  userName: string
  userRole: string
  ipAddress: string | null
  userAgent: string | null
}

/** Chat file paths of the customer's messages: column + legacy metadata, only inside this business's folder. */
export function mediaPathsOf(rows: Array<{ mediaBlobPath: string | null; metadata: Prisma.JsonValue }>, tenantId: string): string[] {
  const prefix = `${CHAT_MEDIA_BLOB_PREFIX}/${tenantId}/`
  const out = new Set<string>()
  for (const r of rows) {
    const meta = r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {}
    for (const p of [r.mediaBlobPath, typeof meta.mediaBlobPath === 'string' ? meta.mediaBlobPath : null]) {
      if (p && p.startsWith(prefix) && !p.includes('..')) out.add(p)
    }
  }
  return [...out]
}

function purgeRowId(tenantId: string, path: string): string {
  return `dmp_${createHash('sha256').update(`${tenantId}|${path}`).digest('hex').slice(0, 40)}`
}

/**
 * Blanks / deletes in ONE transaction, including the audit record, the do-not-re-import entry
 * and the files to remove (an outbox the nightly retention retries). Files are removed right
 * after the commit; failures stay queued.
 */
export async function eraseCustomerData(tenantId: string, scope: ErasureScope, audit: ErasureAudit): Promise<ErasureResult> {
  const { clientId, orderIds, conversationIds } = scope
  assertIds(tenantId, clientId)
  for (const id of [...orderIds, ...conversationIds]) assertIds(id)
  const messageWhere = customerMessageWhere(tenantId, clientId, conversationIds)
  const linkedWhere = customerLinkedWhere(tenantId, clientId, conversationIds)

  const mediaRows = await prismaRaw.chatMessage.findMany({
    where: messageWhere,
    select: { mediaBlobPath: true, metadata: true },
  })
  const mediaPaths = mediaPathsOf(mediaRows, tenantId)

  const counts = await prismaRaw.$transaction(
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
      // Raw client: archived orders too (they keep the data and can be restored for 30 days).
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
                deleteReason: null,
                archiveMetadata: Prisma.DbNull,
              },
            })
          ).count
        : 0

      // Chat-only notes / tasks / alerts / activity BEFORE the chats (their chat link is SET NULL).
      out.notes = (await tx.crmNote.deleteMany({ where: linkedWhere })).count
      out.tasks = (await tx.crmTask.deleteMany({ where: linkedWhere })).count
      out.notifications = (await tx.workspaceNotification.deleteMany({ where: linkedWhere })).count
      out.activity = (await tx.activityEvent.deleteMany({ where: linkedWhere })).count
      await tx.clientLifecycleState.deleteMany({ where: { tenantId, clientId } })

      // Messages first (their chat link is SET NULL, not cascade), then the chats.
      out.messages = (await tx.chatMessage.deleteMany({ where: messageWhere })).count
      if (conversationIds.length) {
        await tx.chatConversationWorkState.deleteMany({ where: { tenantId, conversationId: { in: conversationIds } } })
        out.conversations = (await tx.chatConversation.deleteMany({ where: { tenantId, id: { in: conversationIds } } })).count
      } else {
        out.conversations = 0
      }

      if (orderIds.length) {
        // Order history stays (ids / status), without any free-form details about the person.
        await tx.activityEvent.updateMany({ where: { tenantId, orderId: { in: orderIds } }, data: { props: {} } })
        await tx.clientIdentityConflict.deleteMany({ where: { tenantId, orderId: { in: orderIds } } })
      }

      // Audit trail keeps WHAT happened, not the personal values (audit rows use lower-case types).
      out.auditRedacted = (
        await tx.auditLog.updateMany({
          where: {
            tenantId,
            OR: [
              { entityType: { in: entityTypeFilterAliases('client') }, entityId: clientId },
              ...(orderIds.length ? [{ entityType: { in: entityTypeFilterAliases('order') }, entityId: { in: orderIds } }] : []),
            ],
          },
          data: { entityName: null, reason: null, oldValues: { redacted: 'ley8968' }, newValues: { redacted: 'ley8968' } },
        })
      ).count

      // Do-not-re-import (WhatsApp history sync) + file outbox, in the same transaction.
      if (scope.phone) {
        await tx.$executeRaw`
          INSERT INTO public."DataSubjectSuppression" ("id", "tenantId", "kind", "valueHash")
          VALUES (${`dss_${createHash('sha256').update(`${tenantId}|${clientId}`).digest('hex').slice(0, 40)}`}, ${tenantId}, 'phone', ${suppressionHash(tenantId, scope.phone)})
          ON CONFLICT ("tenantId", "kind", "valueHash") DO NOTHING`
      }
      for (const path of mediaPaths) {
        await tx.$executeRaw`
          INSERT INTO public."DataSubjectMediaPurge" ("id", "tenantId", "path")
          VALUES (${purgeRowId(tenantId, path)}, ${tenantId}, ${path})
          ON CONFLICT ("id") DO NOTHING`
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'DELETE',
          entityType: 'client',
          entityId: clientId,
          entityName: null,
          reason: 'Ley 8968: datos personales del cliente eliminados',
          newValues: { counts: out, mediaFiles: mediaPaths.length },
          userId: audit.userId,
          userName: audit.userName,
          userRole: audit.userRole,
          ipAddress: audit.ipAddress,
          userAgent: audit.userAgent,
        },
      })
      return out
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  const { removed, failed } = await purgeQueuedMedia(tenantId, mediaPaths)
  return { counts, mediaFilesRemoved: removed, mediaFilesFailed: failed }
}

/** Removes queued chat files; anything that fails stays in the outbox for the nightly retry. */
export async function purgeQueuedMedia(tenantId: string, paths: string[]): Promise<{ removed: number; failed: number }> {
  let removed = 0
  let failed = 0
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    try {
      await deleteChatBlobs(batch)
      await prismaRaw.$executeRaw`DELETE FROM public."DataSubjectMediaPurge" WHERE "tenantId" = ${tenantId} AND "path" = ANY(${batch}::text[])`
      removed += batch.length
    } catch {
      failed += batch.length
      await prismaRaw.$executeRaw`
        UPDATE public."DataSubjectMediaPurge" SET "attempts" = "attempts" + 1, "lastAttemptAt" = now()
        WHERE "tenantId" = ${tenantId} AND "path" = ANY(${batch}::text[])`.catch(() => undefined)
    }
  }
  return { removed, failed }
}

/** Nightly retry of files that could not be removed right after an erasure (bounded). */
export async function retryPendingMediaPurges(limit = 500): Promise<{ removed: number; failed: number }> {
  const rows = await prismaRaw.$queryRaw<Array<{ tenantId: string; path: string }>>`
    SELECT "tenantId", "path" FROM public."DataSubjectMediaPurge"
    WHERE "attempts" < 20 ORDER BY "createdAt" ASC LIMIT ${limit}`
  const byTenant = new Map<string, string[]>()
  for (const r of rows) byTenant.set(r.tenantId, [...(byTenant.get(r.tenantId) ?? []), r.path])
  let removed = 0
  let failed = 0
  for (const [tenantId, paths] of byTenant) {
    const prefix = `${CHAT_MEDIA_BLOB_PREFIX}/${tenantId}/`
    const r = await purgeQueuedMedia(tenantId, paths.filter((p) => p.startsWith(prefix) && !p.includes('..')))
    removed += r.removed
    failed += r.failed
  }
  return { removed, failed }
}
