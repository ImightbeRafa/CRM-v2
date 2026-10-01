/**
 * Retention for the Phase 2a/2b workspace logs (SecureDog INFRA-12, 2026-09-29):
 * - ActivityEvent: kept 13 months (enough for year-over-year in the Phase 5 dashboard);
 * - WorkspaceNotification: read ones 90 days, unread ones 180 days.
 * Tasks, notes and stages are business data and are NOT touched here.
 *
 * Batched (ids first, then delete by id) with a time budget so a large backlog never holds long
 * locks; the next nightly run continues. Before 035 / 036: no-op.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'

export const ACTIVITY_RETENTION_DAYS = 395
export const NOTIFICATION_READ_DAYS = 90
export const NOTIFICATION_UNREAD_DAYS = 180
/** Meta click ids (ChatAdReferral.ctwaClid) are only useful for attribution windows of days. */
export const AD_CLICK_ID_DAYS = 90
const DAY = 24 * 60 * 60 * 1000

export function retentionCutoffs(now: Date = new Date()) {
  return {
    activity: new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * DAY),
    notificationRead: new Date(now.getTime() - NOTIFICATION_READ_DAYS * DAY),
    notificationUnread: new Date(now.getTime() - NOTIFICATION_UNREAD_DAYS * DAY),
    adClickId: new Date(now.getTime() - AD_CLICK_ID_DAYS * DAY),
  }
}

type Batcher = () => Promise<number>

async function drain(batch: Batcher, deadline: number, maxBatches: number): Promise<number> {
  let total = 0
  for (let i = 0; i < maxBatches && Date.now() < deadline; i++) {
    const n = await batch()
    total += n
    if (n === 0) break
  }
  return total
}

export async function purgeWorkspaceLogs(opts: { now?: Date; budgetMs?: number; batchSize?: number } = {}) {
  const now = opts.now ?? new Date()
  const deadline = Date.now() + (opts.budgetMs ?? 45_000)
  const size = opts.batchSize ?? 2_000
  const cut = retentionCutoffs(now)
  const result = { activity: 0, notifications: 0, adClickIds: 0, skipped: [] as string[] }

  try {
    result.activity = await drain(async () => {
      const ids = await prisma.activityEvent.findMany({ where: { occurredAt: { lt: cut.activity } }, select: { id: true }, take: size })
      if (!ids.length) return 0
      const res = await prisma.activityEvent.deleteMany({ where: { id: { in: ids.map((r) => r.id) }, occurredAt: { lt: cut.activity } } })
      return res.count
    }, deadline, 50)
  } catch (error) {
    if (!isMissingRelation(error)) throw error
    result.skipped.push('activity_missing')
  }

  try {
    result.notifications = await drain(async () => {
      const ids = await prisma.workspaceNotification.findMany({
        where: { OR: [{ readAt: { lt: cut.notificationRead } }, { readAt: null, createdAt: { lt: cut.notificationUnread } }] },
        select: { id: true },
        take: size,
      })
      if (!ids.length) return 0
      const res = await prisma.workspaceNotification.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } })
      return res.count
    }, deadline, 20)
  } catch (error) {
    if (!isMissingRelation(error)) throw error
    result.skipped.push('notifications_missing')
  }

  try {
    result.adClickIds = await drain(async () => {
      const ids = await prisma.chatAdReferral.findMany({
        where: { ctwaClid: { not: null }, occurredAt: { lt: cut.adClickId } },
        select: { id: true },
        take: size,
      })
      if (!ids.length) return 0
      const res = await prisma.chatAdReferral.updateMany({
        where: { id: { in: ids.map((r) => r.id) } },
        data: { ctwaClid: null },
      })
      return res.count
    }, deadline, 20)
  } catch (error) {
    if (!isMissingRelation(error)) throw error
    result.skipped.push('ad_referrals_missing')
  }
  return result
}
