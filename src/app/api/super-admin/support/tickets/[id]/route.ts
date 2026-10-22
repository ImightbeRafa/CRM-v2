/**
 * One ticket for Rafael: GET full thread (internal notes, drafts, outbox rows).
 * POST actions: reply (public → emails the customer), note (internal), update (status/priority/
 * category/assignee), publish_draft (send an agent draft to the customer), retry_event (outbox).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { adminGetTicket } from '@/lib/support/admin'
import { retrySupportEvent } from '@/lib/support/dispatcher'
import { buildCustomerReplyEmail, resendSender } from '@/lib/support/notify'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'
import {
  SupportTablesMissingError,
  addStaffMessage,
  publishDraft,
  updateSupportTicket,
  withSupportTables,
} from '@/lib/support/tickets'
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  formatTicketRef,
} from '@/lib/support/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin(request)
  if (!guard.ok) return guard.response
  const { id } = await params
  try {
    const ticket = await adminGetTicket(id)
    return ticket ? NextResponse.json({ ticket }, { headers: { 'Cache-Control': 'no-store' } }) : NOT_FOUND()
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NOT_FOUND()
    throw error
  }
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('reply'),
    body: z.string().trim().min(1).max(SUPPORT_LIMITS.messageMax),
    setStatus: z.enum(SUPPORT_STATUSES).optional(),
  }),
  z.object({ action: z.literal('note'), body: z.string().trim().min(1).max(SUPPORT_LIMITS.bodyMax) }),
  z.object({
    action: z.literal('update'),
    status: z.enum(SUPPORT_STATUSES).optional(),
    priority: z.enum(SUPPORT_PRIORITIES).optional(),
    category: z.enum(SUPPORT_CATEGORIES).optional(),
    assignee: z.enum(['grok_agent', 'rafael']).optional(),
  }),
  z.object({ action: z.literal('publish_draft'), messageId: z.string().min(1).max(64) }),
  z.object({ action: z.literal('retry_event'), eventId: z.string().min(1).max(64) }),
])

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireSuperAdmin(request, { write: true })
  if (!guard.ok) return guard.response
  const { id } = await params
  const parsed = actionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 })
  const a = parsed.data
  try {
    const ticket = await withSupportTables(() => prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, number: true, contactEmail: true, status: true },
    }))
    if (!ticket) return NOT_FOUND()
    const ref = formatTicketRef(ticket.number)

    switch (a.action) {
      case 'reply': {
        if (ticket.status === 'spam') return NextResponse.json({ error: 'Ticket marcado como spam' }, { status: 409 })
        const sent = await resendSender(buildCustomerReplyEmail(ticket.contactEmail, ref, a.body))
        if (!sent.ok) return NextResponse.json({ error: 'No se pudo enviar el correo' }, { status: 502 })
        await addStaffMessage({ ticketId: id, author: 'rafael', body: a.body, visibility: 'public', setStatus: a.setStatus ?? 'waiting_customer' })
        return NextResponse.json({ ok: true })
      }
      case 'note':
        await addStaffMessage({ ticketId: id, author: 'rafael', body: a.body, visibility: 'internal' })
        return NextResponse.json({ ok: true })
      case 'update': {
        const res = await updateSupportTicket(id, a)
        return res ? NextResponse.json(res) : NextResponse.json({ error: 'Nada que cambiar' }, { status: 400 })
      }
      case 'publish_draft': {
        if (ticket.status === 'spam') return NextResponse.json({ error: 'Ticket marcado como spam' }, { status: 409 })
        const draft = await prisma.supportTicketMessage.findFirst({ where: { id: a.messageId, ticketId: id, isDraft: true } })
        if (!draft) return NOT_FOUND()
        const sent = await resendSender(buildCustomerReplyEmail(ticket.contactEmail, ref, draft.body))
        if (!sent.ok) return NextResponse.json({ error: 'No se pudo enviar el correo' }, { status: 502 })
        await publishDraft(id, a.messageId)
        return NextResponse.json({ ok: true })
      }
      case 'retry_event': {
        const ev = await prisma.supportTicketEvent.findFirst({ where: { id: a.eventId, ticketId: id }, select: { id: true } })
        if (!ev) return NOT_FOUND()
        await retrySupportEvent(ev.id)
        return NextResponse.json({ ok: true })
      }
    }
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NOT_FOUND()
    throw error
  }
}
