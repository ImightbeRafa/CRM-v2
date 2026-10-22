import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { dispatchPendingSupportEvents } from '@/lib/support/dispatcher'
import { supportViewer } from '@/lib/support/session'
import { SupportTablesMissingError, addCustomerReply, getTicketForViewer } from '@/lib/support/tickets'
import { SUPPORT_LIMITS } from '@/lib/support/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 30, identifier: 'support-reply-user' })
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** Thread, public messages only. Foreign ids are 404 (not 403). */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await supportViewer(request)
  if (!auth.ok) return auth.response
  const { id } = await params
  try {
    const ticket = await getTicketForViewer(auth.viewer, id)
    return ticket ? NextResponse.json({ ticket }) : NOT_FOUND()
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NOT_FOUND()
    throw error
  }
}

const replySchema = z.object({ message: z.string().trim().min(1).max(SUPPORT_LIMITS.messageMax) })

/** Customer reply → message + ticket.customer_replied event; status back to open. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await supportViewer(request)
  if (!auth.ok) return auth.response
  const { id } = await params
  const parsed = replySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Escribí un mensaje.' }, { status: 400 })
  if (!(await limiter(`user:${auth.viewer.userId}`)).allowed) {
    return NextResponse.json({ error: 'Demasiados mensajes. Probá más tarde.' }, { status: 429 })
  }
  try {
    const res = await addCustomerReply(auth.viewer, id, parsed.data.message)
    if (!res) return NOT_FOUND()
    after(() => dispatchPendingSupportEvents({ limit: 5 }).catch(() => undefined))
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NOT_FOUND()
    throw error
  }
}
