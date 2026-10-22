/**
 * Poll fallback, same contract as Advance `GET /api/ticket-events?since=` (SPEC §5):
 * `Authorization: Bearer SUPPORT_WEBHOOK_SECRET` (or a super-admin session) →
 * `{ since, events: [payload…] }`, max 50, payloads already redacted at write time.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'
import { isSuperAdminRequest } from '@/lib/super-admin-helpers'
import { supportPipelineEnabled } from '@/lib/support/config'
import { parseSinceParam } from '@/lib/support/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 30, identifier: 'support-events-poll' })

function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret || secret.length < 16 || !header) return false
  const a = createHash('sha256').update(header).digest()
  const b = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(a, b)
}

export async function GET(request: NextRequest) {
  if (!supportPipelineEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await limiter(`ip:${getClientIP(request)}`)).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const secret = (process.env.SUPPORT_WEBHOOK_SECRET || '').trim()
  const authorized =
    bearerMatches(request.headers.get('authorization'), secret) || (await isSuperAdminRequest(request))
  if (!authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = parseSinceParam(request.nextUrl.searchParams.get('since'))
  try {
    const rows = await prisma.supportTicketEvent.findMany({
      where: { createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: { payload: true },
    })
    return NextResponse.json(
      { since: since.toISOString(), events: rows.map((r) => r.payload) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (isMissingRelation(error)) return NextResponse.json({ since: since.toISOString(), events: [] })
    throw error
  }
}
