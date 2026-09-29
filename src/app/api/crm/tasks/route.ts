import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createTask, listTasks } from '@/lib/crm-tasks'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

async function conversationFor(tenantId: string, id: string) {
  if (!ID_RE.test(id)) return null
  return prisma.chatConversation.findFirst({ where: { id, tenantId }, select: { id: true, clientId: true } })
}

/**
 * GET ?conversationId=… → open tasks of that chat and its client (+ done with includeDone=1).
 * GET ?mine=1           → tasks assigned to me in this business ("Mis tareas").
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const sp = request.nextUrl.searchParams
  const includeDone = sp.get('includeDone') === '1'
  if (sp.get('mine') === '1') {
    const result = await listTasks({ tenantId: auth.tenantId, assigneeUserId: auth.userId, includeDone, viewer: { userId: auth.userId, role: auth.role } })
    return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const conversationId = sp.get('conversationId') || ''
  const conversation = await conversationFor(auth.tenantId, conversationId)
  if (!conversation) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  const result = await listTasks({ tenantId: auth.tenantId, conversationId: conversation.id, clientId: conversation.clientId, includeDone, viewer: { userId: auth.userId, role: auth.role } })
  return NextResponse.json({ success: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

/** POST `{ conversationId, title, kind?, dueAt?, assigneeUserId? }` — task on the chat and its client. */
export async function POST(request: NextRequest) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const rate = await workspaceWriteRateLimit(`${auth.tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Demasiados cambios seguidos. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }
  const json = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const conversation = await conversationFor(auth.tenantId, typeof json?.conversationId === 'string' ? json.conversationId : '')
  if (!conversation) return NextResponse.json({ success: false, error: 'Chat no encontrado' }, { status: 404 })
  const result = await createTask({
    tenantId: auth.tenantId,
    userId: auth.userId,
    title: json?.title,
    kind: json?.kind,
    dueAt: json?.dueAt,
    assigneeUserId: json?.assigneeUserId,
    // The client comes from the chat of THIS business, never from the body.
    conversationId: conversation.id,
    clientId: conversation.clientId,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })
  return NextResponse.json({ success: true, task: result.task }, { status: 201 })
}
