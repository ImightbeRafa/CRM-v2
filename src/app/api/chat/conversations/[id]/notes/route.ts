import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createNote, listNotes, parseNoteScope } from '@/lib/crm-notes'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

async function conversationFor(tenantId: string, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, tenantId },
    select: { id: true, clientId: true },
  })
}

/** Notes of this chat AND of its linked client (a client's notes follow them across chats). */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const conversation = await conversationFor(auth.tenantId, id)
  if (!conversation) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  const result = await listNotes({
    tenantId: auth.tenantId,
    viewer: { userId: auth.userId, role: auth.role },
    clientId: conversation.clientId,
    conversationId: conversation.id,
  })
  return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { id } = await context.params
  const conversation = await conversationFor(auth.tenantId, id)
  if (!conversation) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Demasiadas notas seguidas. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }

  const json = (await request.json().catch(() => null)) as { body?: unknown; scope?: unknown } | null
  // "todo el cliente" (default, stored with the linked client) or "solo este chat".
  const scope = json?.scope === undefined ? 'client' : parseNoteScope(json.scope)
  if (!scope) return NextResponse.json({ success: false, error: 'scope debe ser "client" o "chat"' }, { status: 400 })
  const result = await createNote({
    tenantId: auth.tenantId,
    viewer: { userId: auth.userId, role: auth.role },
    body: json?.body,
    clientId: scope === 'client' ? conversation.clientId : null,
    conversationId: conversation.id,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, note: result.note }, { status: 201 })
}
