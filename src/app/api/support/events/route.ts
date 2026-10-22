/**
 * Poll fallback, same contract as Advance `GET /api/ticket-events?since=` (SPEC §5):
 * `Authorization: Bearer SUPPORT_POLL_TOKEN` (its own token, not the push secret; or a live super-admin
 * session) →
 * `{ since, next_since, has_more, events: [payload…] }`, max 50, payloads redacted at write time.
 * Only the agent's token gets `betsy.reply_token` on each event.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'
import { requireSuperAdmin } from '@/lib/support/super-admin-guard'
import { withReplyToken } from '@/lib/support/mcp/reply-token'
import type { SupportEventPayload } from '@/lib/support/events'
import { supportPipelineEnabled } from '@/lib/support/config'
import { parseSinceParam } from '@/lib/support/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 30, identifier: 'support-events-poll' })

function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret || secret.length < 32 || !header) return false
  const a = createHash('sha256').update(header).digest()
  const b = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!supportPipelineEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await limiter(`ip:${getClientIP(request)}`)).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const secret = (process.env.SUPPORT_POLL_TOKEN || '').trim()
  const agent = bearerMatches(request.headers.get('authorization'), secret)
  const authorized =
    agent || (!request.headers.get('authorization') && (await requireSuperAdmin(request)).ok)
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = parseSinceParam(request.nextUrl.searchParams.get('since'))
  try {
    const rows = await prisma.supportTicketEvent.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { payload: true, createdAt: true },
    })
    // next_since = the last event's own time (payload created_at is the ticket's); pass it back to page on.
    const last = rows.at(-1)
    return NextResponse.json(
      {
        since: since.toISOString(),
        next_since: last ? last.createdAt.toISOString() : since.toISOString(),
        has_more: rows.length === 50,
        events: rows.map((r) =>
          agent ? withReplyToken(r.payload as SupportEventPayload, process.env.NEXTAUTH_SECRET) : r.payload,
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (isMissingRelation(error)) return NextResponse.json({ since: since.toISOString(), events: [] })
    throw error
  }
}
