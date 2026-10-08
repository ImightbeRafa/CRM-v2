import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { recordActivity } from '@/lib/activity'
import { workspaceWriteRateLimit } from '@/lib/rate-limit'
import { isSameOriginJson } from '@/lib/same-origin'
import { maskPhone } from '@/lib/chat-order-flow'
import { parseOrderSearch, phoneTail, phoneTails, rankAttachCandidates, searchPhoneDigits } from '@/lib/chat-order-attach'
import { orderIdsByPhoneDigits, orderIdsByPhoneTails } from '@/lib/chat-order-attach-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const candidateSelect = {
  id: true,
  orderId: true,
  customerName: true,
  phone: true,
  status: true,
  total: true,
  product: true,
  timestamp: true,
  salesChannel: true,
} as const

const RECENT_DAYS = 30

async function loadConversation(tenantId: string, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      peerId: true,
      peerName: true,
      clientId: true,
      socialAccount: { select: { platform: true } },
      client: { select: { name: true, phone: true } },
    },
  })
}

type Conversation = NonNullable<Awaited<ReturnType<typeof loadConversation>>>

function chatPhone(conversation: Conversation): string | null {
  return conversation.socialAccount?.platform === 'whatsapp' ? conversation.peerId : null
}

function jsonError(error: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ success: false, error, ...extra }, { status })
}

/**
 * GET /api/chat/conversations/[id]/orders?q=
 * Orders that can be attached to this chat ("Vincular pedido"). Without `q`: orders with the
 * chat's / client's phone or name, then recent orders (30 days) that no chat has yet. With
 * `q`: search by order number, name or phone. Orders already in this chat are left out.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { tenantId } = auth
  const { id } = await context.params
  const conversation = await loadConversation(tenantId, id)
  if (!conversation) return jsonError('Chat no encontrado', 404)

  const search = parseOrderSearch(new URL(request.url).searchParams.get('q'))
  const tails = phoneTails([chatPhone(conversation), conversation.client?.phone])
  const names = [conversation.peerName, conversation.client?.name].filter((n): n is string => Boolean(n))

  const inThisChat = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId: conversation.id, orderId: { not: null } },
    select: { orderId: true },
    distinct: ['orderId'],
    take: 50,
  })
  const excluded = inThisChat.map((m) => m.orderId).filter((v): v is string => Boolean(v))

  let rows: Array<{
    id: string
    orderId: string
    customerName: string
    phone: string | null
    status: string
    total: number
    product: string | null
    timestamp: Date
    salesChannel: string | null
  }>
  let recentIds: Set<string> | undefined
  if (search.kind === 'text') {
    const notExcluded = excluded.length ? { id: { notIn: excluded } } : {}
    const digitIds = search.digits ? await orderIdsByPhoneDigits(tenantId, searchPhoneDigits(search.digits), 15) : []
    // Exact number in its own query, so newer partial matches never push it out of the list.
    const [exactRows, otherRows] = await Promise.all([
      prisma.order.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...notExcluded,
          OR: [
            { orderId: { equals: search.text, mode: 'insensitive' } },
            { orderId: { endsWith: `-${search.text}`, mode: 'insensitive' } },
          ],
        },
        select: candidateSelect,
        orderBy: { timestamp: 'desc' },
        take: 5,
      }),
      prisma.order.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...notExcluded,
          OR: [
            { orderId: { contains: search.text, mode: 'insensitive' } },
            { customerName: { contains: search.text, mode: 'insensitive' } },
            ...(digitIds.length ? [{ id: { in: digitIds } }] : []),
          ],
        },
        select: candidateSelect,
        orderBy: { timestamp: 'desc' },
        take: 15,
      }),
    ])
    const seen = new Set<string>()
    rows = [...exactRows, ...otherRows].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).slice(0, 15)
  } else {
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000)
    const phoneIds = await orderIdsByPhoneTails(tenantId, tails, 10)
    const firstNames = names.map((n) => n.trim().split(/\s+/)[0]).filter((n) => n.length >= 3)
    const [mine, recent] = await Promise.all([
      phoneIds.length || firstNames.length
        ? prisma.order.findMany({
            where: {
              tenantId,
              deletedAt: null,
              ...(excluded.length ? { id: { notIn: excluded } } : {}),
              OR: [
                ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
                ...firstNames.map((n) => ({ customerName: { startsWith: n, mode: 'insensitive' as const }, timestamp: { gte: since } })),
              ],
            },
            select: candidateSelect,
            orderBy: { timestamp: 'desc' },
            take: 10,
          })
        : Promise.resolve([]),
      // Recent orders no chat has claimed yet (typically website orders).
      prisma.order.findMany({
        where: {
          tenantId,
          deletedAt: null,
          timestamp: { gte: since },
          chatMessages: { none: { tenantId } },
        },
        select: candidateSelect,
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),
    ])
    const seen = new Set<string>()
    rows = [...mine, ...recent].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    recentIds = new Set(recent.map((o) => o.id))
  }

  // Which of them already belong to another chat (shown as a hint, linking is still allowed).
  const elsewhere = rows.length
    ? await prisma.chatMessage.findMany({
        where: { tenantId, orderId: { in: rows.map((o) => o.id) }, NOT: { conversationId: conversation.id } },
        select: { orderId: true },
        distinct: ['orderId'],
      })
    : []
  const elsewhereSet = new Set(elsewhere.map((m) => m.orderId))

  const ranked = rankAttachCandidates(rows, {
    tails,
    names,
    searching: search.kind === 'text',
    query: search.kind === 'text' ? search.text : '',
    recentIds,
  })
  return NextResponse.json(
    {
      success: true,
      orders: ranked.map(({ phone, timestamp, ...o }) => ({
        ...o,
        timestamp: timestamp.toISOString(),
        phoneMasked: maskPhone(phone),
        phoneMatchesChat: Boolean(phoneTail(phone) && tails.includes(phoneTail(phone) as string)),
        inOtherChat: elsewhereSet.has(o.id),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * POST /api/chat/conversations/[id]/orders { orderId, confirmPhoneMismatch? }
 * Attaches an existing order to this chat: sets `ChatMessage.orderId` on the chat's latest
 * message that has no order yet (inbound preferred). Idempotent, never overwrites another
 * order's link. Another phone than the chat's needs an explicit confirmation (it is a human
 * claim, and the chat may then receive that order's guía).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  if (!isSameOriginJson(request)) return jsonError('Origen no permitido', 403)
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { tenantId } = auth
  const { id } = await context.params
  const conversation = await loadConversation(tenantId, id)
  if (!conversation) return jsonError('Chat no encontrado', 404)

  const rate = await workspaceWriteRateLimit(`${tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }

  const body = (await request.json().catch(() => null)) as { orderId?: unknown; confirmPhoneMismatch?: unknown } | null
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim().slice(0, 64) : ''
  if (!orderId) return jsonError('Falta el pedido', 400)

  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId, deletedAt: null },
    select: { id: true, orderId: true, phone: true, clientId: true },
  })
  if (!order) return jsonError('Pedido no encontrado', 404)

  const already = await prisma.chatMessage.findFirst({
    where: { tenantId, conversationId: conversation.id, orderId: order.id },
    select: { id: true },
  })
  if (already) return NextResponse.json({ success: true, already: true, orderId: order.orderId })

  const chatTail = phoneTail(chatPhone(conversation))
  const orderTail = phoneTail(order.phone)
  const sameClient = Boolean(order.clientId && conversation.clientId && order.clientId === conversation.clientId)
  const phoneMismatch = !(chatTail && orderTail && chatTail === orderTail) && !sameClient
  if (phoneMismatch && body?.confirmPhoneMismatch !== true) {
    return jsonError('El teléfono del pedido no es el de este chat.', 409, {
      code: 'phone_mismatch',
      orderPhoneMasked: maskPhone(order.phone),
    })
  }

  // Target: latest message of this chat with no order, inbound first. Conditional write so a
  // concurrent link never overwrites another order; one retry picks the next free message.
  let linkedMessageId: string | null = null
  for (let attempt = 0; attempt < 2 && !linkedMessageId; attempt++) {
    const target =
      (await prisma.chatMessage.findFirst({
        where: { tenantId, conversationId: conversation.id, orderId: null, direction: 'inbound' },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      })) ??
      (await prisma.chatMessage.findFirst({
        where: { tenantId, conversationId: conversation.id, orderId: null },
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }))
    if (!target) break
    const written = await prisma.chatMessage.updateMany({
      where: { id: target.id, tenantId, orderId: null },
      data: { orderId: order.id },
    })
    if (written.count === 1) linkedMessageId = target.id
  }
  if (!linkedMessageId) {
    return jsonError('Este chat no tiene mensajes libres para vincular el pedido.', 409)
  }

  // Any UPDATE bumps `revision` (trigger 024): open inboxes pick up the linked order.
  await prisma.chatConversation
    .updateMany({ where: { id: conversation.id, tenantId }, data: { updatedAt: new Date() } })
    .catch((err: unknown) => console.warn('[chat orders] revision bump failed', err))

  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    description: `Pedido #${order.orderId} vinculado al chat`,
    oldValues: {},
    newValues: { orderId: order.id, orderNumber: order.orderId, messageId: linkedMessageId, phoneMismatch, source: 'manual' },
    userId: auth.userId,
    userRole: auth.role,
    tenantId,
  }).catch(() => {})

  void recordActivity({
    tenantId,
    actorUserId: auth.userId,
    verb: 'chat.order.link',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    conversationId: conversation.id,
    clientId: conversation.clientId ?? null,
    orderId: order.id,
    surface: 'chats',
    props: { phoneMismatch },
  })

  return NextResponse.json({ success: true, orderId: order.orderId })
}

/**
 * DELETE /api/chat/conversations/[id]/orders { orderId }
 * Removes the order from this chat (clears `ChatMessage.orderId` on this chat's messages only).
 * The order itself is untouched.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOriginJson(request)) return jsonError('Origen no permitido', 403)
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { tenantId } = auth
  const { id } = await context.params
  const conversation = await loadConversation(tenantId, id)
  if (!conversation) return jsonError('Chat no encontrado', 404)

  const rate = await workspaceWriteRateLimit(`${tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }

  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim().slice(0, 64) : ''
  if (!orderId) return jsonError('Falta el pedido', 400)

  const cleared = await prisma.chatMessage.updateMany({
    where: { tenantId, conversationId: conversation.id, orderId },
    data: { orderId: null },
  })
  if (cleared.count === 0) return NextResponse.json({ success: true, already: true })

  // A Purchase queued for Meta because of this chat must not go out once the order leaves it.
  await prisma.$executeRaw`
    UPDATE public."MetaConversionEvent" SET "status" = 'expired', "lastErrorCode" = 'chat_unlinked', "updatedAt" = now()
    WHERE "tenantId" = ${tenantId} AND "orderId" = ${orderId} AND "conversationId" = ${conversation.id}
      AND "status" = 'pending'`.catch((err: unknown) => console.warn('[chat orders] meta event expiry skipped', err))

  await prisma.chatConversation
    .updateMany({ where: { id: conversation.id, tenantId }, data: { updatedAt: new Date() } })
    .catch((err: unknown) => console.warn('[chat orders] revision bump failed', err))

  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    description: 'Pedido quitado del chat',
    oldValues: { orderId },
    newValues: { orderId: null, messages: cleared.count },
    userId: auth.userId,
    userRole: auth.role,
    tenantId,
  }).catch(() => {})

  void recordActivity({
    tenantId,
    actorUserId: auth.userId,
    verb: 'chat.order.unlink',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    conversationId: conversation.id,
    clientId: conversation.clientId ?? null,
    orderId,
    surface: 'chats',
  })

  return NextResponse.json({ success: true })
}
