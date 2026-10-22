import { NextRequest, NextResponse } from 'next/server'
import { adminListTickets, adminOutboxHealth } from '@/lib/support/admin'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'
import { SupportTablesMissingError } from '@/lib/support/tickets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Rafael's support inbox: tickets (filter by status / channel incl. agent_request) + outbox health. */
export async function GET(request: NextRequest) {
  const guard = await requireSuperAdmin(request)
  if (!guard.ok) return guard.response
  const q = request.nextUrl.searchParams
  try {
    const [tickets, outbox] = await Promise.all([
      adminListTickets({ status: q.get('status'), source: q.get('source') }),
      adminOutboxHealth(),
    ])
    return NextResponse.json({ ready: true, tickets, outbox }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SupportTablesMissingError) return NextResponse.json({ ready: false, tickets: [], outbox: null })
    throw error
  }
}
