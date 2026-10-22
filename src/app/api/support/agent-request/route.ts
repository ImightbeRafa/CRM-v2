import { NextRequest, NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { dispatchPendingSupportEvents } from '@/lib/support/dispatcher'
import { supportViewer, viewerContact } from '@/lib/support/session'
import { SupportTablesMissingError, createSupportTicket } from '@/lib/support/tickets'
import { AGENT_REQUEST_CHANNELS } from '@/lib/support/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 24 * 60 * 60_000, maxRequests: 3, identifier: 'support-agent-request' })

const schema = z.object({
  businessType: z.string().trim().max(120).optional().nullable(),
  channels: z.array(z.enum(AGENT_REQUEST_CHANNELS)).max(4).optional(),
  message: z.string().trim().min(10).max(3000),
  phone: z.string().trim().max(30).regex(/^[+\d\s()-]*$/).optional().nullable(),
})

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  web: 'Sitio web',
}

/** "Quiero mi agente" lead from the Agents tab → agent_request ticket. 3 per business per day. */
export async function POST(request: NextRequest) {
  const auth = await supportViewer(request)
  if (!auth.ok) return auth.response
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Contanos un poco más (mínimo 10 caracteres).' }, { status: 400 })
  }
  if (!(await limiter(`tenant:${auth.viewer.tenantId}`)).allowed) {
    return NextResponse.json({ error: 'Ya recibimos tu solicitud. Te contactamos pronto.' }, { status: 429 })
  }
  const contact = await viewerContact(auth.viewer.userId)
  if (!contact) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const d = parsed.data
  const channels = (d.channels || []).map((c) => CHANNEL_LABEL[c]).join(', ') || '—'
  const body = [
    `Tipo de negocio: ${d.businessType || '—'}`,
    `Canales: ${channels}`,
    // The phone stays in meta (read via MCP), not in the text pushed to the webhook.
    `Teléfono: ${d.phone ? 'sí (ver ticket)' : '—'}`,
    '',
    d.message,
  ].join('\n')
  try {
    const ticket = await createSupportTicket({
      source: 'agent_request',
      tenantId: auth.viewer.tenantId,
      userId: auth.viewer.userId,
      contact,
      subject: 'Quiero mi agente de IA',
      body,
      category: 'agent_request',
      priority: 'high',
      meta: { phone: d.phone || null, channels: d.channels || [], businessType: d.businessType || null },
    })
    after(() => dispatchPendingSupportEvents({ limit: 5 }).catch(() => undefined))
    return NextResponse.json({ ok: true, ticketNumber: ticket.ref }, { status: 201 })
  } catch (error) {
    if (error instanceof SupportTablesMissingError) {
      return NextResponse.json({ error: 'support_unavailable' }, { status: 503 })
    }
    throw error
  }
}
