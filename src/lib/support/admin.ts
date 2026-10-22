/**
 * Super-admin (Rafael) views of the support pipeline. Callers check requireSuperAdmin first.
 * Full data (internal notes, drafts, contact email) — never exposed to tenants.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { formatTicketRef, isOneOf, SUPPORT_SOURCES, SUPPORT_STATUSES } from './types'
import { withSupportTables } from './tickets'

export async function adminListTickets(filter: { status?: string | null; source?: string | null; limit?: number }) {
  return withSupportTables(async () => {
    const rows = await prisma.supportTicket.findMany({
      where: {
        ...(isOneOf(SUPPORT_STATUSES, filter.status) ? { status: filter.status } : {}),
        ...(isOneOf(SUPPORT_SOURCES, filter.source) ? { source: filter.source } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filter.limit ?? 100, 1), 200),
    })
    const tenantIds = [...new Set(rows.map((r) => r.tenantId).filter((t): t is string => Boolean(t)))]
    const tenants = tenantIds.length
      ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
      : []
    const names = new Map(tenants.map((t) => [t.id, t.name]))
    return rows.map((r) => ({
      id: r.id,
      ref: formatTicketRef(r.number),
      subject: r.subject,
      status: r.status,
      category: r.category,
      priority: r.priority,
      source: r.source,
      assignee: r.assignee,
      contactEmail: r.contactEmail,
      tenantName: r.tenantId ? names.get(r.tenantId) ?? null : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  })
}

export async function adminOutboxHealth() {
  return withSupportTables(async () => {
    const [pendingWebhook, pendingEmail, failedWebhook, failedEmail, recentFailed] = await Promise.all([
      prisma.supportTicketEvent.count({ where: { webhookStatus: 'pending' } }),
      prisma.supportTicketEvent.count({ where: { emailStatus: 'pending' } }),
      prisma.supportTicketEvent.count({ where: { webhookStatus: 'failed' } }),
      prisma.supportTicketEvent.count({ where: { emailStatus: 'failed' } }),
      prisma.supportTicketEvent.findMany({
        where: { OR: [{ webhookStatus: 'failed' }, { emailStatus: 'failed' }] },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, ticketId: true, type: true, webhookStatus: true, emailStatus: true, attempts: true, lastError: true, createdAt: true },
      }),
    ])
    return {
      pendingWebhook,
      pendingEmail,
      failedWebhook,
      failedEmail,
      recentFailed: recentFailed.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    }
  })
}

export async function adminGetTicket(id: string) {
  return withSupportTables(async () => {
    const t = await prisma.supportTicket.findUnique({ where: { id } })
    if (!t) return null
    const [messages, events, tenant] = await Promise.all([
      prisma.supportTicketMessage.findMany({ where: { ticketId: id }, orderBy: { createdAt: 'asc' }, take: 300 }),
      prisma.supportTicketEvent.findMany({
        where: { ticketId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, type: true, webhookStatus: true, emailStatus: true, attempts: true, lastError: true, createdAt: true },
      }),
      t.tenantId ? prisma.tenant.findUnique({ where: { id: t.tenantId }, select: { id: true, name: true, plan: true } }) : null,
    ])
    return {
      id: t.id,
      ref: formatTicketRef(t.number),
      subject: t.subject,
      status: t.status,
      category: t.category,
      priority: t.priority,
      source: t.source,
      assignee: t.assignee,
      contactName: t.contactName,
      contactEmail: t.contactEmail,
      meta: t.meta,
      tenant: tenant ? { ...tenant, plan: String(tenant.plan) } : null,
      createdAt: t.createdAt.toISOString(),
      messages: messages.map((m) => ({
        id: m.id,
        author: m.author,
        visibility: m.visibility,
        isDraft: m.isDraft,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
      events: events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
    }
  })
}
