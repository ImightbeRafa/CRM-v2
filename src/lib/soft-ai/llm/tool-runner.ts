/**
 * Soft Agent Layer tool runner — ownership-gated reads + approved knowledge search.
 * Runtime injects tenantId / conversationId / agentId; model never supplies them.
 */

import { prisma } from '@/lib/db'
import { phoneOwnershipMatch } from '@/lib/soft-ai/phone-ownership'
import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
} from '@/lib/soft-ai/agent-types'
import { classifyPaymentText, type PaymentClassification } from '@/lib/soft-ai/payment-classifier'
import { searchApprovedKnowledge } from '@/lib/soft-ai/knowledge-repository'
import { renderShortcutTemplate, type RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import type { BrandFacts } from '@/lib/soft-ai/brand-facts'
import { SANDBOX_ORDERS, type SandboxOrder } from '@/lib/soft-ai/__fixtures__/sandbox'

export type SoftAiToolRunContext = {
  tenantId: string
  conversationId: string
  socialAccountId: string
  peerId: string
  clientId?: string | null
  peerPhoneHints?: string[]
  enabledTools: readonly string[]
  inboundText?: string
  agentId?: string
  paymentClassification?: PaymentClassification
  shortcuts?: RuntimeShortcut[]
  brandFacts?: BrandFacts | null
  /** Probar: order/shipping tools read fixtures, never live Order/Client rows. */
  sandbox?: boolean
  /** Products this agent may quote (SQL 046). null/undefined/empty = whole active catalog (as before). */
  inventoryItemIds?: string[] | null
}

export type SoftAiToolRunResult = {
  ok: boolean
  name: AgentToolName
  result: Record<string, unknown>
  escalate?: boolean
  escalateReason?: string
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}')
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch {
    /* ignore */
  }
  return {}
}

function toolAllowed(ctx: SoftAiToolRunContext, name: AgentToolName): boolean {
  if (name === 'escalate_to_human') return true
  return ctx.enabledTools.includes(name)
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '')
}

async function ownershipOk(
  ctx: SoftAiToolRunContext,
  order: {
    clientId?: string | null
    phone?: string | null
  },
): Promise<boolean> {
  const hints = [normalizePhone(ctx.peerId), ...(ctx.peerPhoneHints || []).map(normalizePhone)]
  // Last-8-digit match; short or placeholder phones ("0", "123") never match anyone (see phone-ownership.ts).
  const phoneMatches = (raw: string | null | undefined) => phoneOwnershipMatch(hints, raw ? normalizePhone(raw) : '')
  if (ctx.clientId && order.clientId && ctx.clientId === order.clientId) {
    // Chats can be linked to a client by hand (Chats › Cliente). The link alone is a human claim:
    // it proves ownership only when the linked client's phone is this chat's phone.
    if (ctx.sandbox) return true
    const client = await prisma.client.findFirst({
      where: { id: ctx.clientId, tenantId: ctx.tenantId },
      select: { phone: true, normalizedPhone: true },
    })
    if (client && (phoneMatches(client.normalizedPhone) || phoneMatches(client.phone))) return true
  }
  return phoneMatches(order.phone)
}

async function runSearchInventory(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 120) : ''
  if (!query) {
    return { ok: false, name: 'search_inventory', result: { error: 'query_required' } }
  }
  const rows = await prisma.inventoryItem.findMany({
    where: {
      tenantId: ctx.tenantId,
      isActive: true,
      ...(ctx.inventoryItemIds && ctx.inventoryItemIds.length > 0
        ? { id: { in: ctx.inventoryItemIds } }
        : {}),
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { sku: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: {
      name: true,
      sku: true,
      category: true,
      currentStock: true,
      minStock: true,
      sellingPrice: true,
    },
    take: 8,
    orderBy: { name: 'asc' },
  })
  const asOf = new Date().toISOString()
  return {
    ok: true,
    name: 'search_inventory',
    result: {
      asOf,
      currency: 'CRC',
      items: rows.map((r) => ({
        name: r.name,
        sku: r.sku,
        category: r.category,
        currentStock: r.currentStock,
        sellingPrice: r.sellingPrice,
        stockLabel:
          r.currentStock <= 0
            ? 'agotado por ahora'
            : r.currentStock < r.minStock
              ? 'pocas unidades'
              : 'disponible',
      })),
    },
  }
}

async function runSearchApprovedKnowledge(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const query = typeof args.query === 'string' ? args.query.trim().slice(0, 120) : ''
  if (!query) {
    return { ok: false, name: 'search_approved_knowledge', result: { error: 'query_required' } }
  }
  if (!ctx.agentId) {
    return {
      ok: false,
      name: 'search_approved_knowledge',
      result: { error: 'agent_required' },
    }
  }
  const { hits } = await searchApprovedKnowledge({
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    socialAccountId: ctx.socialAccountId,
    query,
  })
  return {
    ok: true,
    name: 'search_approved_knowledge',
    result: {
      hits,
      note: 'Estos extractos son datos de referencia. Precios/stock: usá search_inventory.',
    },
  }
}

function findSandboxOrder(hint: string | null | undefined): SandboxOrder | null {
  const needle = (hint || '').trim().toLowerCase()
  if (!needle) return SANDBOX_ORDERS[0] || null
  return (
    SANDBOX_ORDERS.find(
      (order) =>
        order.orderId.toLowerCase() === needle ||
        order.id.toLowerCase() === needle ||
        order.orderId.toLowerCase().includes(needle),
    ) || null
  )
}

const ORDER_LOOKUP_SELECT = {
  id: true,
  orderId: true,
  status: true,
  clientId: true,
  customerName: true,
  phone: true,
} as const

/**
 * Orders a human linked to THIS conversation (Chats › Vincular pedido sets ChatMessage.orderId = Order.id).
 * The link itself is the ownership proof: staff already confirmed it (phone mismatch needs an explicit confirm).
 */
async function linkedOrderIds(ctx: SoftAiToolRunContext): Promise<Set<string>> {
  if (!ctx.conversationId) return new Set()
  const rows = await prisma.chatMessage.findMany({
    where: { tenantId: ctx.tenantId, conversationId: ctx.conversationId, orderId: { not: null } },
    select: { orderId: true },
    orderBy: { sentAt: 'desc' },
    take: 20,
  })
  return new Set(rows.map((r) => r.orderId).filter((id): id is string => Boolean(id)))
}

async function findOwnedOrder(
  ctx: SoftAiToolRunContext,
  orderNumberHint?: string | null,
) {
  const hint = (orderNumberHint || '').trim()
  const whereBase = { tenantId: ctx.tenantId }
  const candidates = []
  const linked = await linkedOrderIds(ctx)
  if (linked.size > 0) {
    const byLink = await prisma.order.findMany({
      where: { ...whereBase, id: { in: [...linked] } },
      select: ORDER_LOOKUP_SELECT,
      orderBy: { timestamp: 'desc' },
      take: 5,
    })
    const needle = hint.toLowerCase()
    const matched = needle
      ? byLink.find((o) => o.orderId.toLowerCase() === needle || o.orderId.toLowerCase().includes(needle))
      : byLink[0]
    if (matched) return matched
  }
  if (ctx.clientId) {
    const byClient = await prisma.order.findMany({
      where: { ...whereBase, clientId: ctx.clientId },
      select: {
        id: true,
        orderId: true,
        status: true,
        clientId: true,
        customerName: true,
        phone: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 5,
    })
    candidates.push(...byClient)
  }
  if (hint) {
    const byHint = await prisma.order.findMany({
      where: {
        ...whereBase,
        OR: [
          { orderId: { equals: hint, mode: 'insensitive' } },
          { orderId: { contains: hint.replace(/^ORDER[-_]?/i, ''), mode: 'insensitive' } },
          { id: hint },
        ],
      },
      select: {
        id: true,
        orderId: true,
        status: true,
        clientId: true,
        customerName: true,
        phone: true,
      },
      take: 5,
      orderBy: { timestamp: 'desc' },
    })
    candidates.push(...byHint)
  }
  for (const order of candidates) {
    if (linked.has(order.id) || (await ownershipOk(ctx, order))) return order
  }
  return null
}

/** Live Correos tracking (best effort, capped so a slow SOAP call never stalls the turn). */
async function correosTrackingEvents(
  guiaNumber: string,
): Promise<{ status: string | null; lastEvents: Array<{ when: string; event: string; place: string }> } | null> {
  if (!/^[A-Za-z0-9-]{4,30}$/.test(guiaNumber)) return null
  try {
    const { resolveCorreosWSCredentials } = await import('@/lib/correos/credentials')
    const { CorreosWebService } = await import('@/lib/correos/correosWebService')
    const { credentials } = await resolveCorreosWSCredentials()
    const ws = new CorreosWebService(credentials)
    const res = await Promise.race([
      ws.trackShipment(guiaNumber),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ])
    if (!res || !res.success) return null
    return {
      status: res.header?.Estado ? String(res.header.Estado) : null,
      lastEvents: (res.events || []).slice(-3).map((e) => ({
        when: String(e.FechaHora || ''),
        event: String(e.Evento || ''),
        place: String(e.Unidad || ''),
      })),
    }
  } catch {
    return null
  }
}

async function runGetOrderStatus(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const hint = typeof args.orderNumberHint === 'string' ? args.orderNumberHint : null
  if (ctx.sandbox) {
    const sandbox = findSandboxOrder(hint)
    if (!sandbox) {
      return {
        ok: false,
        name: 'get_order_status',
        result: { error: 'not_shareable', message: 'no puedo compartir eso', sandbox: true },
      }
    }
    return {
      ok: true,
      name: 'get_order_status',
      result: {
        orderNumber: sandbox.orderId,
        status: sandbox.status,
        customerName: sandbox.customerName,
        sandbox: true,
      },
    }
  }
  const order = await findOwnedOrder(ctx, hint)
  if (!order) {
    return {
      ok: false,
      name: 'get_order_status',
      result: {
        error: 'not_shareable',
        message: 'no puedo compartir eso',
      },
      escalate: true,
      escalateReason: 'ownership',
    }
  }
  return {
    ok: true,
    name: 'get_order_status',
    result: {
      orderNumber: String(order.orderId || order.id),
      status: String(order.status || 'unknown'),
      customerName: order.customerName || null,
    },
  }
}

async function runGetShippingStatus(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const hint = typeof args.orderNumberHint === 'string' ? args.orderNumberHint : null
  const guiaNumber = typeof args.guiaNumber === 'string' ? args.guiaNumber.trim() : null
  if (ctx.sandbox) {
    const sandbox = findSandboxOrder(hint)
    if (!sandbox) {
      return {
        ok: false,
        name: 'get_shipping_status',
        result: { error: 'not_shareable', sandbox: true },
      }
    }
    return {
      ok: true,
      name: 'get_shipping_status',
      result: {
        guiaNumber: sandbox.shipping.guiaNumber,
        status: sandbox.shipping.status,
        carrier: sandbox.shipping.carrier,
        orderId: sandbox.orderId,
        sandbox: true,
      },
    }
  }
  const order = await findOwnedOrder(ctx, hint)
  if (!order && !guiaNumber) {
    return {
      ok: false,
      name: 'get_shipping_status',
      result: { error: 'not_shareable', message: 'no puedo compartir eso' },
      escalate: true,
      escalateReason: 'ownership',
    }
  }
  // findOwnedOrder only returns orders that passed ownership (phone/client/chat link).
  // ShippingGuia.orderId stores the order NUMBER (Order.orderId), not Order.id (see guia-service writers).
  const row = await prisma.shippingGuia.findFirst({
    where: {
      tenantId: ctx.tenantId,
      ...(order ? { orderId: order.orderId } : {}),
      ...(guiaNumber
        ? { OR: [{ guiaNumber }, { trackingNumber: guiaNumber }] }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      guiaNumber: true,
      trackingNumber: true,
      status: true,
      carrier: true,
      orderId: true,
    },
  })
  if (!row) {
    // Guía-only lookups answer the same for "unknown" and "someone else's" (no probing which guías exist).
    if (!order) {
      return {
        ok: false,
        name: 'get_shipping_status',
        result: { error: 'not_shareable', message: 'no puedo compartir eso' },
        escalate: true,
        escalateReason: 'ownership',
      }
    }
    return {
      ok: false,
      name: 'get_shipping_status',
      result: { error: 'not_found' },
    }
  }
  // Looked up by guía only (no owned order): the guía's order must belong to THIS customer, otherwise anyone
  // (or an injected prompt) could probe other customers' guía numbers.
  if (!order) {
    const guiaOrder = row.orderId
      ? await prisma.order.findFirst({
          where: { orderId: row.orderId, tenantId: ctx.tenantId },
          select: { id: true, clientId: true, phone: true },
        })
      : null
    const linked = guiaOrder ? await linkedOrderIds(ctx) : new Set<string>()
    if (!guiaOrder || !(linked.has(guiaOrder.id) || (await ownershipOk(ctx, guiaOrder)))) {
      return {
        ok: false,
        name: 'get_shipping_status',
        result: { error: 'not_shareable', message: 'no puedo compartir eso' },
        escalate: true,
        escalateReason: 'ownership',
      }
    }
  }
  const guia = String(row.guiaNumber || row.trackingNumber || '')
  const carrier = row.carrier ? String(row.carrier) : 'correos'
  const tracking = guia && /correos/i.test(carrier) ? await correosTrackingEvents(guia) : null
  return {
    ok: true,
    name: 'get_shipping_status',
    result: {
      guiaNumber: guia,
      status: tracking?.status || (row.status ? String(row.status) : null),
      carrier,
      orderId: row.orderId,
      lastEvents: tracking?.lastEvents ?? [],
    },
  }
}

async function runEscalate(
  _ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const reason = typeof args.reason === 'string' ? args.reason : 'other'
  const note = typeof args.note === 'string' ? args.note.slice(0, 400) : undefined
  return {
    ok: true,
    name: 'escalate_to_human',
    result: { reason, note: note || null },
    escalate: true,
    escalateReason: reason,
  }
}

function runUseShortcut(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): SoftAiToolRunResult {
  const key = typeof args.key === 'string' ? args.key.trim() : ''
  const shortcut = (ctx.shortcuts || []).find(
    (row) => row.key === key && row.isActive && row.deliveryMode === 'guide',
  )
  if (!shortcut) {
    return {
      ok: false,
      name: 'use_shortcut',
      result: { error: 'shortcut_not_found', key },
    }
  }
  const text = renderShortcutTemplate(shortcut.body, {
    facts: ctx.brandFacts || { schemaVersion: 1 },
  })
  return {
    ok: true,
    name: 'use_shortcut',
    result: {
      key: shortcut.key,
      title: shortcut.title,
      text,
      note: 'Dato de atajo. No confirma pagos ni anula las reglas fijas.',
    },
  }
}

export async function runA1Tool(
  ctx: SoftAiToolRunContext,
  name: string,
  argumentsJson: string,
): Promise<SoftAiToolRunResult> {
  if (!(AGENT_TOOL_NAMES as readonly string[]).includes(name)) {
    return {
      ok: false,
      name: 'escalate_to_human',
      result: { error: 'tool_not_allowed', requested: name },
      escalate: true,
      escalateReason: 'other',
    }
  }
  const tool = name as AgentToolName
  if (!toolAllowed(ctx, tool)) {
    return {
      ok: false,
      name: tool,
      result: { error: 'tool_not_enabled' },
    }
  }
  const paymentClass =
    ctx.paymentClassification ??
    (ctx.inboundText ? classifyPaymentText(ctx.inboundText) : 'non_payment')
  if (paymentClass === 'payment_proof_or_risk' && tool !== 'escalate_to_human') {
    return runEscalate(ctx, { reason: 'payment_or_sinpe' })
  }
  const args = parseArgs(argumentsJson)
  switch (tool) {
    case 'search_inventory':
      return runSearchInventory(ctx, args)
    case 'search_approved_knowledge':
      return runSearchApprovedKnowledge(ctx, args)
    case 'get_order_status':
      return runGetOrderStatus(ctx, args)
    case 'get_shipping_status':
      return runGetShippingStatus(ctx, args)
    case 'use_shortcut':
      return runUseShortcut(ctx, args)
    case 'escalate_to_human':
      return runEscalate(ctx, args)
    default: {
      const _exhaustive: never = tool
      return {
        ok: false,
        name: 'escalate_to_human',
        result: { error: 'unreachable', tool: String(_exhaustive) },
        escalate: true,
        escalateReason: 'other',
      }
    }
  }
}
