import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { staffDisplayName } from '@/lib/display-name'
import { parsePresenceState, presenceStore } from '@/lib/chat-presence'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Heartbeats (15 s) + typing pings (≤ 1 / 3 s) + reads (5 s): own bucket, never the write quota. */
const presenceRateLimit = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 120, identifier: 'chat-presence' })

// Small caches: presence is polled often; the tenant check and display name rarely change.
const CONV_TTL_MS = 5 * 60_000
const NAME_TTL_MS = 10 * 60_000
const convOk = new Map<string, number>()
const names = new Map<string, { name: string; until: number }>()

async function conversationBelongs(tenantId: string, id: string): Promise<boolean> {
  const key = `${tenantId}:${id}`
  const until = convOk.get(key)
  if (until && until > Date.now()) return true
  const conv = await prisma.chatConversation.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!conv) return false
  if (convOk.size > 5_000) convOk.clear()
  convOk.set(key, Date.now() + CONV_TTL_MS)
  return true
}

async function displayName(userId: string): Promise<string> {
  const hit = names.get(userId)
  if (hit && hit.until > Date.now()) return hit.name
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, username: true } })
  // Same rule as the rest of the inbox: never an email.
  const name = staffDisplayName(u?.name ?? null, u?.username ?? null) || 'Alguien del equipo'
  if (names.size > 2_000) names.clear()
  names.set(userId, { name, until: Date.now() + NAME_TTL_MS })
  return name
}

async function guard(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return { error: auth.response }
  const rate = await presenceRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) return { error: NextResponse.json({ success: false, error: 'rate_limited' }, { status: 429, headers: rate.headers }) }
  const { id } = await context.params
  if (!(await conversationBelongs(auth.tenantId, id))) return { error: NextResponse.json({ success: false, error: 'Not found' }, { status: 404 }) }
  return { auth, id }
}

/** Who else is in this chat right now (never includes the caller). */
export async function GET(request: NextRequest, context: RouteContext) {
  const g = await guard(request, context)
  if ('error' in g) return g.error
  const people = presenceStore.list(g.auth.tenantId, g.id, g.auth.userId)
  return NextResponse.json({ success: true, people }, { headers: { 'Cache-Control': 'no-store' } })
}

/** `{ state: 'viewing' | 'typing' }` refreshes me; `{ state: 'left' }` removes me. */
export async function POST(request: NextRequest, context: RouteContext) {
  const g = await guard(request, context)
  if ('error' in g) return g.error
  const json = (await request.json().catch(() => null)) as { state?: unknown } | null
  if (json?.state === 'left') {
    presenceStore.leave(g.auth.tenantId, g.id, g.auth.userId)
    return NextResponse.json({ success: true })
  }
  const state = parsePresenceState(json?.state)
  if (!state) return NextResponse.json({ success: false, error: 'state inválido' }, { status: 400 })
  presenceStore.touch(g.auth.tenantId, g.id, { userId: g.auth.userId, name: await displayName(g.auth.userId), state })
  const people = presenceStore.list(g.auth.tenantId, g.id, g.auth.userId)
  return NextResponse.json({ success: true, people }, { headers: { 'Cache-Control': 'no-store' } })
}
