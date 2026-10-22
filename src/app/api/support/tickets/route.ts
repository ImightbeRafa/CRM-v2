import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { dispatchPendingSupportEvents } from '@/lib/support/dispatcher'
import { supportViewer, viewerContact } from '@/lib/support/session'
import { SupportTablesMissingError, createSupportTicket, listTicketsForViewer } from '@/lib/support/tickets'
import { SUPPORT_LIMITS } from '@/lib/support/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 10, identifier: 'support-ticket-user' })

/** Own tickets; OWNER/ADMIN also see their business's tickets. Never cross-business. */
export async function GET(request: NextRequest) {
  const auth = await supportViewer(request)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ tickets: await listTicketsForViewer(auth.viewer) })
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NextResponse.json({ tickets: [] })
    throw error
  }
}

const createSchema = z.object({
  subject: z.string().trim().min(1).max(SUPPORT_LIMITS.subject),
  message: z.string().trim().min(SUPPORT_LIMITS.messageMin).max(SUPPORT_LIMITS.messageMax),
  category: z.enum(['bug', 'billing', 'question', 'feature', 'other']).optional(),
  pageUrl: z.string().max(2000).optional().nullable(),
})

/** In-app ticket. Business and user come from the session only. */
export async function POST(request: NextRequest) {
  const auth = await supportViewer(request)
  if (!auth.ok) return auth.response
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Revisá asunto y mensaje.' }, { status: 400 })
  if (!(await limiter(`user:${auth.viewer.userId}`)).allowed) {
    return NextResponse.json({ error: 'Demasiados tickets. Probá más tarde.' }, { status: 429 })
  }
  const contact = await viewerContact(auth.viewer.userId)
  if (!contact) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const ticket = await createSupportTicket({
      source: 'in_app',
      tenantId: auth.viewer.tenantId,
      userId: auth.viewer.userId,
      contact,
      subject: parsed.data.subject,
      body: parsed.data.message,
      category: parsed.data.category ?? 'question',
      meta: { pageUrl: parsed.data.pageUrl || null },
    })
    after(() => dispatchPendingSupportEvents({ limit: 5 }).catch(() => undefined))
    return NextResponse.json({ ok: true, id: ticket.id, ticketNumber: ticket.ref }, { status: 201 })
  } catch (error) {
    if (error instanceof SupportTablesMissingError) {
      return NextResponse.json({ error: 'El soporte no está disponible en este momento. Escribinos por WhatsApp o correo.' }, { status: 503 })
    }
    throw error
  }
}
