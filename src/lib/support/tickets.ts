/**
 * The ONLY write path for support tickets (SPEC §2). Every route calls these
 * functions; nothing else inserts SupportTicket rows. A ticket, its first
 * message and its outbox event are written in ONE transaction, so a ticket can
 * never exist without its `ticket.created` delivery.
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { viewerTicketWhere, canViewerSeeTicket, type SupportViewer } from './access'
import { supportBaseUrl } from './config'
import { buildTicketEventPayload, type SupportEventTicketInput } from './events'
import { clip } from './redact'
import { sanitizeHeaderText } from './spam'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  formatTicketRef,
  isOneOf,
  type SupportEventType,
  type SupportMessageAuthor,
  type SupportMessageVisibility,
  type SupportTicketCategory,
  type SupportTicketMeta,
  type SupportTicketPriority,
  type SupportTicketSource,
  type SupportTicketStatus,
} from './types'

export class SupportTablesMissingError extends Error {
  constructor() {
    super('support_tables_missing')
  }
}

/** Runs a support query; a missing 059 table becomes SupportTablesMissingError. */
export async function withSupportTables<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isMissingRelation(error)) throw new SupportTablesMissingError()
    throw error
  }
}

export type CreateSupportTicketInput = {
  source: SupportTicketSource
  tenantId: string | null
  userId: string | null
  contact: { name?: string | null; email: string }
  subject: string
  body: string
  category?: SupportTicketCategory
  priority?: SupportTicketPriority
  /** `spam` stores the row without any outbox event (no webhook, no email). */
  status?: Extract<SupportTicketStatus, 'open' | 'spam'>
  meta?: SupportTicketMeta
  legacyFeedbackTicketId?: string | null
  /**
   * Historical import (scripts/backfill-feedback-to-support.ts only): keeps the original status and
   * dates, adds the old admin notes as an internal message, and writes NO outbox event.
   */
  backfill?: { status: SupportTicketStatus; createdAt: Date; resolvedAt: Date | null; internalNote: string | null }
}

export type CreatedSupportTicket = { id: string; number: number; ref: string; status: string }

function newEventId(): string {
  return `evt_${randomUUID().replace(/-/g, '')}`
}

async function tenantSummary(tenantId: string | null) {
  if (!tenantId) return null
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, plan: true } })
  return t ? { id: t.id, name: t.name, plan: t.plan ? String(t.plan) : null } : null
}

function eventInput(
  ticket: {
    id: string
    number: bigint | number
    subject: string
    category: string
    priority: string
    status: string
    source: string
    contactEmail: string
    contactName: string | null
    meta: unknown
    createdAt: Date
  },
  description: string,
  tenant: SupportEventTicketInput['tenant'],
): SupportEventTicketInput {
  const meta = (ticket.meta && typeof ticket.meta === 'object' ? ticket.meta : {}) as SupportTicketMeta
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    description,
    category: ticket.category,
    priority: ticket.priority,
    status: ticket.status,
    source: ticket.source,
    contactEmail: ticket.contactEmail,
    contactName: ticket.contactName,
    pageUrl: typeof meta.pageUrl === 'string' ? meta.pageUrl : null,
    phone: typeof meta.phone === 'string' ? meta.phone : null,
    createdAt: ticket.createdAt,
    tenant,
  }
}

export async function createSupportTicket(input: CreateSupportTicketInput): Promise<CreatedSupportTicket> {
  const email = input.contact.email.trim().toLowerCase().slice(0, 254)
  const subject = sanitizeHeaderText(input.subject, SUPPORT_LIMITS.subject) || '(sin asunto)'
  const body = clip(input.body.trim(), SUPPORT_LIMITS.bodyMax)
  const name = input.contact.name ? sanitizeHeaderText(input.contact.name, SUPPORT_LIMITS.name) || null : null
  const category = isOneOf(SUPPORT_CATEGORIES, input.category) ? input.category : 'question'
  const priority = isOneOf(SUPPORT_PRIORITIES, input.priority) ? input.priority : 'normal'
  const backfill = input.backfill && isOneOf(SUPPORT_STATUSES, input.backfill.status) ? input.backfill : null
  const status = backfill ? backfill.status : input.status === 'spam' ? 'spam' : 'open'
  const tenant = await withSupportTables(() => tenantSummary(input.tenantId))
  const now = backfill ? backfill.createdAt : new Date()

  return withSupportTables(() =>
    prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId,
          source: input.source,
          category,
          priority,
          status,
          subject,
          contactName: name,
          contactEmail: email,
          meta: (input.meta || {}) as object,
          legacyFeedbackTicketId: input.legacyFeedbackTicketId || null,
          lastCustomerMessageAt: now,
          ...(backfill ? { createdAt: backfill.createdAt, resolvedAt: backfill.resolvedAt } : {}),
        },
      })
      await tx.supportTicketMessage.create({
        data: { ticketId: ticket.id, author: 'customer', visibility: 'public', body, createdAt: now },
      })
      if (backfill?.internalNote) {
        await tx.supportTicketMessage.create({
          data: { ticketId: ticket.id, author: 'rafael', visibility: 'internal', body: clip(backfill.internalNote, SUPPORT_LIMITS.bodyMax), createdAt: now },
        })
      }
      if (status !== 'spam' && !backfill) {
        const id = newEventId()
        const payload = buildTicketEventPayload('ticket.created', eventInput(ticket, body, tenant), {
          deliveryId: id,
          baseUrl: supportBaseUrl(),
        })
        await tx.supportTicketEvent.create({
          data: { id, ticketId: ticket.id, type: 'ticket.created', payload: payload as object },
        })
      }
      const number = Number(ticket.number)
      return { id: ticket.id, number, ref: formatTicketRef(number), status }
    }),
  )
}

/** Writes an outbox event for an existing ticket (inside the caller's transaction). */
async function enqueueEvent(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  type: SupportEventType,
  ticketId: string,
  description: string,
) {
  const ticket = await tx.supportTicket.findUnique({ where: { id: ticketId } })
  if (!ticket || ticket.status === 'spam') return
  const tenant = await tenantSummary(ticket.tenantId)
  const id = newEventId()
  const payload = buildTicketEventPayload(type, eventInput(ticket, description, tenant), {
    deliveryId: id,
    baseUrl: supportBaseUrl(),
  })
  await tx.supportTicketEvent.create({ data: { id, ticketId, type, payload: payload as object } })
}

// ---------------------------------------------------------------------------
// Customer side (session-scoped)
// ---------------------------------------------------------------------------

const CUSTOMER_STATUS_LABEL: Record<string, string> = {
  open: 'Abierto',
  ai_answered: 'Respondido',
  waiting_customer: 'Esperando tu respuesta',
  escalated: 'En revisión',
  resolved: 'Resuelto',
  closed: 'Cerrado',
}

export function customerStatusLabel(status: string): string {
  return CUSTOMER_STATUS_LABEL[status] || 'Abierto'
}

export async function listTicketsForViewer(viewer: SupportViewer, limit = 50) {
  const rows = await withSupportTables(() =>
    prisma.supportTicket.findMany({
      where: viewerTicketWhere(viewer),
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        number: true,
        subject: true,
        category: true,
        status: true,
        source: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  )
  return rows.map((r) => ({
    id: r.id,
    ref: formatTicketRef(r.number),
    subject: r.subject,
    category: r.category,
    status: r.status,
    statusLabel: customerStatusLabel(r.status),
    source: r.source,
    mine: r.userId === viewer.userId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

const FEEDBACK_STATUS: Record<string, string> = {
  open: 'open',
  ai_answered: 'in_progress',
  waiting_customer: 'in_progress',
  escalated: 'in_progress',
  resolved: 'resolved',
  closed: 'closed',
}

/**
 * The caller's own tickets in this business, in the legacy FeedbackTicket shape the in-app
 * FeedbackWidget reads (/api/feedback GET). description = first message, adminNotes = the
 * latest public support reply (never internal notes or drafts).
 */
export async function listFeedbackShapedTickets(userId: string, tenantId: string) {
  const rows = await withSupportTables(() =>
    prisma.supportTicket.findMany({
      where: { userId, tenantId, NOT: { status: 'spam' } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  )
  if (!rows.length) return []
  const messages = await prisma.supportTicketMessage.findMany({
    where: { ticketId: { in: rows.map((r) => r.id) }, visibility: 'public', isDraft: false },
    orderBy: { createdAt: 'asc' },
    select: { ticketId: true, author: true, body: true },
  })
  return rows.map((r) => {
    const thread = messages.filter((m) => m.ticketId === r.id)
    const first = thread.find((m) => m.author === 'customer')
    const lastReply = [...thread].reverse().find((m) => m.author !== 'customer')
    return {
      id: r.id,
      ref: formatTicketRef(r.number),
      tenantId: r.tenantId,
      userId: r.userId,
      category: r.category,
      subject: r.subject,
      description: first?.body ?? '',
      status: FEEDBACK_STATUS[r.status] || 'open',
      priority: r.priority,
      adminNotes: lastReply?.body ?? null,
      legacyFeedbackTicketId: r.legacyFeedbackTicketId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }
  })
}

/** Thread with PUBLIC, non-draft messages only. null = not found or not allowed (caller answers 404). */
export async function getTicketForViewer(viewer: SupportViewer, ticketId: string) {
  if (typeof ticketId !== 'string' || ticketId.length > 64) return null
  const ticket = await withSupportTables(() => prisma.supportTicket.findUnique({ where: { id: ticketId } }))
  if (!ticket || ticket.status === 'spam' || !canViewerSeeTicket(viewer, ticket)) return null
  const messages = await prisma.supportTicketMessage.findMany({
    where: { ticketId: ticket.id, visibility: 'public', isDraft: false },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { id: true, author: true, body: true, createdAt: true },
  })
  return {
    id: ticket.id,
    ref: formatTicketRef(ticket.number),
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    statusLabel: customerStatusLabel(ticket.status),
    createdAt: ticket.createdAt.toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      fromSupport: m.author !== 'customer',
      author: m.author === 'customer' ? 'customer' : 'support',
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  }
}

/** Customer reply → message + `ticket.customer_replied` event, status back to open. */
export async function addCustomerReply(viewer: SupportViewer, ticketId: string, body: string) {
  const text = clip(body.trim(), SUPPORT_LIMITS.messageMax)
  return withSupportTables(() =>
    prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({
        where: { id: ticketId },
        select: { id: true, userId: true, tenantId: true, status: true },
      })
      if (!ticket || ticket.status === 'spam' || !canViewerSeeTicket(viewer, ticket)) return null
      const now = new Date()
      await tx.supportTicketMessage.create({
        data: { ticketId, author: 'customer', visibility: 'public', body: text },
      })
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'open', lastCustomerMessageAt: now, resolvedAt: null },
      })
      await enqueueEvent(tx, 'ticket.customer_replied', ticketId, text)
      return { ok: true as const }
    }),
  )
}

// ---------------------------------------------------------------------------
// Support side (MCP agent / super admin). Callers authorize before calling.
// ---------------------------------------------------------------------------

export type SupportStaffAuthor = Extract<SupportMessageAuthor, 'grok_agent' | 'rafael'>

export async function addStaffMessage(input: {
  ticketId: string
  author: SupportStaffAuthor
  body: string
  visibility: SupportMessageVisibility
  isDraft?: boolean
  setStatus?: SupportTicketStatus | null
}) {
  const text = clip(input.body.trim(), SUPPORT_LIMITS.bodyMax)
  return withSupportTables(() =>
    prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({ where: { id: input.ticketId }, select: { id: true } })
      if (!ticket) return null
      const message = await tx.supportTicketMessage.create({
        data: {
          ticketId: input.ticketId,
          author: input.author,
          visibility: input.visibility,
          isDraft: Boolean(input.isDraft),
          body: text,
        },
      })
      const data: Record<string, unknown> = {}
      if (input.visibility === 'public' && !input.isDraft) data.lastAgentMessageAt = new Date()
      if (input.setStatus && isOneOf(SUPPORT_STATUSES, input.setStatus)) {
        data.status = input.setStatus
        if (input.setStatus === 'resolved' || input.setStatus === 'closed') data.resolvedAt = new Date()
      }
      if (Object.keys(data).length) await tx.supportTicket.update({ where: { id: input.ticketId }, data })
      return { messageId: message.id }
    }),
  )
}

/** Turns an internal draft into a public reply (Rafael approves from super admin). */
export async function publishDraft(ticketId: string, messageId: string) {
  return withSupportTables(() =>
    prisma.$transaction(async (tx) => {
      const msg = await tx.supportTicketMessage.findFirst({ where: { id: messageId, ticketId, isDraft: true } })
      if (!msg) return null
      await tx.supportTicketMessage.update({
        where: { id: messageId },
        data: { isDraft: false, visibility: 'public' },
      })
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { lastAgentMessageAt: new Date(), status: 'ai_answered' },
      })
      return { body: msg.body }
    }),
  )
}

export async function updateSupportTicket(
  ticketId: string,
  patch: { status?: unknown; priority?: unknown; category?: unknown; assignee?: 'grok_agent' | 'rafael' },
) {
  const data: Record<string, unknown> = {}
  if (isOneOf(SUPPORT_STATUSES, patch.status)) {
    data.status = patch.status
    data.resolvedAt = patch.status === 'resolved' || patch.status === 'closed' ? new Date() : null
  }
  if (isOneOf(SUPPORT_PRIORITIES, patch.priority)) data.priority = patch.priority
  if (isOneOf(SUPPORT_CATEGORIES, patch.category)) data.category = patch.category
  if (patch.assignee === 'grok_agent' || patch.assignee === 'rafael') data.assignee = patch.assignee
  if (!Object.keys(data).length) return null
  return withSupportTables(async () => {
    const res = await prisma.supportTicket.updateMany({ where: { id: ticketId }, data })
    return res.count ? { ok: true as const, changed: Object.keys(data) } : null
  })
}

/** status escalated + assignee rafael + internal note + `ticket.escalated` event (emails Rafael). */
export async function escalateSupportTicket(ticketId: string, reason: string, author: SupportStaffAuthor) {
  const text = clip(reason.trim() || 'Escalado', 2000)
  return withSupportTables(() =>
    prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({ where: { id: ticketId }, select: { id: true, status: true } })
      if (!ticket) return null
      await tx.supportTicket.update({ where: { id: ticketId }, data: { status: 'escalated', assignee: 'rafael' } })
      await tx.supportTicketMessage.create({
        data: { ticketId, author, visibility: 'internal', body: `Escalado: ${text}` },
      })
      await enqueueEvent(tx, 'ticket.escalated', ticketId, text)
      return { ok: true as const }
    }),
  )
}

export async function findTicketIdByRef(ref: number): Promise<string | null> {
  const row = await withSupportTables(() =>
    prisma.supportTicket.findUnique({ where: { number: BigInt(ref) }, select: { id: true } }),
  )
  return row?.id ?? null
}
