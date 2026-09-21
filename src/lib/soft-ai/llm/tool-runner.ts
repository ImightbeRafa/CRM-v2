/**
 * Soft Agent Layer tool runner — ownership-gated reads + approved knowledge search.
 * Runtime injects tenantId / conversationId / agentId; model never supplies them.
 */

import { prisma } from '@/lib/db'
import {
  AGENT_TOOL_NAMES,
  type AgentToolName,
} from '@/lib/soft-ai/agent-types'
import { isPaymentSensitiveText } from '@/lib/soft-ai/config'
import { searchApprovedKnowledge } from '@/lib/soft-ai/knowledge-repository'

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
  if (ctx.clientId && order.clientId && ctx.clientId === order.clientId) return true
  const orderPhone = order.phone ? normalizePhone(order.phone) : ''
  if (!orderPhone) return false
  const hints = [
    normalizePhone(ctx.peerId),
    ...(ctx.peerPhoneHints || []).map(normalizePhone),
  ].filter(Boolean)
  return hints.some(
    (h) => h === orderPhone || h.endsWith(orderPhone.slice(-8)) || orderPhone.endsWith(h.slice(-8)),
  )
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

async function findOwnedOrder(
  ctx: SoftAiToolRunContext,
  orderNumberHint?: string | null,
) {
  const hint = (orderNumberHint || '').trim()
  const whereBase = { tenantId: ctx.tenantId }
  const candidates = []
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
    if (await ownershipOk(ctx, order)) return order
  }
  return null
}

async function runGetOrderStatus(
  ctx: SoftAiToolRunContext,
  args: Record<string, unknown>,
): Promise<SoftAiToolRunResult> {
  const hint = typeof args.orderNumberHint === 'string' ? args.orderNumberHint : null
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
  if (order) {
    const owned = await ownershipOk(ctx, order)
    if (!owned) {
      return {
        ok: false,
        name: 'get_shipping_status',
        result: { error: 'not_shareable', message: 'no puedo compartir eso' },
        escalate: true,
        escalateReason: 'ownership',
      }
    }
  }
  const row = await prisma.shippingGuia.findFirst({
    where: {
      tenantId: ctx.tenantId,
      ...(order ? { orderId: order.id } : {}),
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
    return {
      ok: false,
      name: 'get_shipping_status',
      result: { error: 'not_found' },
    }
  }
  return {
    ok: true,
    name: 'get_shipping_status',
    result: {
      guiaNumber: String(row.guiaNumber || row.trackingNumber || ''),
      status: row.status ? String(row.status) : null,
      carrier: row.carrier ? String(row.carrier) : 'correos',
      orderId: row.orderId,
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
  if (ctx.inboundText && isPaymentSensitiveText(ctx.inboundText) && tool !== 'escalate_to_human') {
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
