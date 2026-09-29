import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { recordActivity } from '@/lib/activity'
import { normalizeClientPhone } from '@/lib/order-lifecycle'
import { chatSendRateLimit } from '@/lib/rate-limit'
import { maskPhone } from '@/lib/chat-order-flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const clientSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  username: true,
  province: true,
  canton: true,
  totalOrders: true,
  totalSpent: true,
  lastOrder: true,
  isFavorite: true,
  // Legacy free-text note on the client: shown read-only as "Nota original" in the rail.
  notes: true,
} as const

const orderSelect = {
  id: true,
  orderId: true,
  customerName: true,
  phone: true,
  orderType: true,
  status: true,
  total: true,
  product: true,
  timestamp: true,
  delivery: true,
} as const

type ClientRow = {
  id: string
  name: string
  phone: string
  email: string | null
  username: string | null
  province: string
  canton: string
  totalOrders: number
  totalSpent: number
  lastOrder: Date
  isFavorite: boolean
}

function clientDto(c: ClientRow) {
  return { ...c, lastOrder: c.lastOrder instanceof Date ? c.lastOrder.toISOString() : c.lastOrder }
}

async function loadConversation(tenantId: string, id: string) {
  return prisma.chatConversation.findFirst({
    where: { id, tenantId },
    select: { id: true, clientId: true, peerId: true, peerName: true, socialAccount: { select: { platform: true } } },
  })
}

/**
 * GET /api/chat/conversations/[id]/client?q=
 * Linked client (stats + recent orders: the client's and the ones created from this chat),
 * plus phone-match suggestions and an optional name/phone search to link another client.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { tenantId } = auth
  const { id } = await context.params
  const conversation = await loadConversation(tenantId, id)
  if (!conversation) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 60)

  const client = conversation.clientId
    ? await prisma.client.findFirst({ where: { id: conversation.clientId, tenantId }, select: clientSelect })
    : null

  // Orders created from this chat (ChatMessage.orderId) + the client's own orders.
  const chatOrderIds = await prisma.chatMessage.findMany({
    where: { tenantId, conversationId: conversation.id, orderId: { not: null } },
    select: { orderId: true },
    distinct: ['orderId'],
    take: 20,
  })
  const linkedIds = chatOrderIds.map((m) => m.orderId).filter((v): v is string => Boolean(v))
  const orderOr: Array<Record<string, unknown>> = []
  if (linkedIds.length) orderOr.push({ id: { in: linkedIds } })
  if (client) orderOr.push({ clientId: client.id })
  const orders = orderOr.length
    ? await prisma.order.findMany({
        where: { tenantId, deletedAt: null, OR: orderOr },
        select: orderSelect,
        orderBy: { timestamp: 'desc' },
        take: 10,
      })
    : []

  // Guía per order (latest) and whether it was already sent in this chat.
  const peerPhone =
    conversation.socialAccount?.platform === 'whatsapp' ? normalizeClientPhone(conversation.peerId) : null

  const guias = orders.length
    ? await prisma.shippingGuia.findMany({
        where: { tenantId, orderId: { in: orders.map((o) => o.orderId) }, pdfData: { not: null } },
        select: { id: true, orderId: true, guiaNumber: true, trackingNumber: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })
    : []
  const latestGuia = new Map<string, (typeof guias)[number]>()
  for (const g of guias) if (!latestGuia.has(g.orderId)) latestGuia.set(g.orderId, g)
  const sentGuias = new Map<string, string>()
  if (latestGuia.size) {
    const docs = await prisma.chatMessage.findMany({
      where: { tenantId, conversationId: conversation.id, direction: 'outbound', messageType: 'document' },
      select: { metadata: true, sentAt: true },
      orderBy: { sentAt: 'desc' },
      take: 50,
    })
    for (const d of docs) {
      const guiaId = (d.metadata as Record<string, unknown> | null)?.guiaId
      if (typeof guiaId === 'string' && !sentGuias.has(guiaId)) sentGuias.set(guiaId, d.sentAt.toISOString())
    }
  }

  let suggestions: ClientRow[] = []
  if (!client) {
    const normalized =
      conversation.socialAccount?.platform === 'whatsapp' ? normalizeClientPhone(conversation.peerId) : null
    if (normalized) {
      suggestions = await prisma.client.findMany({
        where: { tenantId, isActive: true, normalizedPhone: normalized },
        select: clientSelect,
        take: 3,
      })
    }
  }

  let results: ClientRow[] = []
  if (q.length >= 2) {
    const digits = q.replace(/\D/g, '')
    results = await prisma.client.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
          ...(digits.length >= 4 ? [{ normalizedPhone: { contains: digits } }, { phone: { contains: digits } }] : []),
        ],
      },
      select: clientSelect,
      orderBy: { lastOrder: 'desc' },
      take: 8,
    })
  }

  return NextResponse.json(
    {
      success: true,
      client: client ? clientDto(client) : null,
      orders: orders.map((o) => {
        const g = latestGuia.get(o.orderId)
        const { phone, ...rest } = o
        const orderPhone = normalizeClientPhone(phone)
        return {
          ...rest,
          phoneMasked: maskPhone(phone),
          phoneMatchesChat: Boolean(orderPhone && peerPhone && orderPhone === peerPhone),
          timestamp: o.timestamp.toISOString(),
          guia: g ? { id: g.id, number: g.guiaNumber || g.trackingNumber || null, createdAt: g.createdAt.toISOString() } : null,
          guiaSentAt: g ? sentGuias.get(g.id) ?? null : null,
        }
      }),
      suggestions: suggestions.map(clientDto),
      results: results.map(clientDto),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** PUT /api/chat/conversations/[id]/client { clientId: string | null } — link / unlink. */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  const { tenantId } = auth
  const { id } = await context.params
  const conversation = await loadConversation(tenantId, id)
  if (!conversation) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

  const rate = await chatSendRateLimit(`${tenantId}:${auth.userId}`)
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Demasiados cambios. Esperá un momento.' }, { status: 429, headers: rate.headers })
  }

  const body = (await request.json().catch(() => null)) as { clientId?: unknown; confirmPhoneMismatch?: unknown } | null
  if (!body || !('clientId' in body)) {
    return NextResponse.json({ success: false, error: 'Falta el cliente' }, { status: 400 })
  }
  const clientId = body.clientId === null ? null : typeof body.clientId === 'string' ? body.clientId.trim() : ''
  if (clientId === '') return NextResponse.json({ success: false, error: 'Cliente inválido' }, { status: 400 })

  let phoneMismatch = false
  if (clientId) {
    const target = await prisma.client.findFirst({
      where: { id: clientId, tenantId },
      select: { id: true, phone: true, normalizedPhone: true },
    })
    if (!target) return NextResponse.json({ success: false, error: 'Cliente no encontrado' }, { status: 404 })
    const peer = conversation.socialAccount?.platform === 'whatsapp' ? normalizeClientPhone(conversation.peerId) : null
    const clientPhone = target.normalizedPhone || normalizeClientPhone(target.phone)
    // Instagram chats have no phone to compare: every manual link there is a human claim too.
    phoneMismatch = !peer || !clientPhone || peer !== clientPhone
    if (phoneMismatch && body.confirmPhoneMismatch !== true) {
      return NextResponse.json(
        {
          success: false,
          code: 'phone_mismatch',
          error: 'El teléfono del cliente no coincide con este chat.',
          clientPhoneMasked: maskPhone(target.phone),
        },
        { status: 409 },
      )
    }
  }

  await prisma.chatConversation.updateMany({ where: { id: conversation.id, tenantId }, data: { clientId } })

  await logAuditEvent({
    action: 'UPDATE',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    description: clientId ? 'Chat vinculado a cliente' : 'Chat desvinculado del cliente',
    oldValues: { clientId: conversation.clientId },
    newValues: { clientId, phoneMismatch, source: 'manual' },
    userId: auth.userId,
    userRole: auth.role,
    tenantId,
  }).catch(() => {})

  void recordActivity({
    tenantId,
    actorUserId: auth.userId,
    verb: clientId ? 'chat.client.link' : 'chat.client.unlink',
    entityType: 'ChatConversation',
    entityId: conversation.id,
    conversationId: conversation.id,
    clientId: clientId ?? conversation.clientId ?? null,
    surface: 'chats',
    props: { phoneMismatch },
  })

  return NextResponse.json({ success: true, clientId })
}
