/**
 * Soft Tenant AI tools — create/link order, status, Correos guía, tag, escalate.
 * DEMO mode is honest stubs (no Meta, no production writes).
 * Server mode may look up ShippingGuia / Order when deps provided.
 *
 * HARD LOCK: does not import /api/bot or lib/bot/whatsapp.
 */

import type { SoftTag } from '@/lib/chat-soft-copilot'
import { isToolAllowed } from '@/lib/soft-ai/config'
import type {
  SoftAiConfig,
  SoftAiToolLogEntry,
  SoftAiToolName,
  SoftAiTurnInput,
} from '@/lib/soft-ai/types'

export type SoftAiToolDeps = {
  /** Optional DB order lookup by id or orderNumber. */
  findOrder?: (query: {
    orderId?: string | null
    orderNumberHint?: string | null
  }) => Promise<{
    id: string
    orderNumber: string
    status: string
    customerName?: string | null
  } | null>
  /** Optional ShippingGuia / Correos lookup. */
  findGuia?: (query: {
    orderId?: string | null
    guiaNumber?: string | null
  }) => Promise<{
    guiaNumber: string
    status?: string | null
    carrier?: string | null
    source: 'db' | 'correos' | 'stub'
  } | null>
}

export type SoftAiToolContext = {
  input: SoftAiTurnInput
  config: SoftAiConfig
  tags: SoftTag[]
  orderId: string | null
  deps?: SoftAiToolDeps
  nowMs: number
}

export type SoftAiToolOutcome = {
  log: SoftAiToolLogEntry
  tags: SoftTag[]
  orderId: string | null
  escalate?: boolean
  escalateReason?: string
  /** Text snippet for the customer reply. */
  replyHint?: string
}

function logEntry(
  tool: SoftAiToolName,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  ok: boolean,
  nowMs: number,
): SoftAiToolLogEntry {
  return {
    id: `tool-${tool}-${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
    tool,
    args,
    result,
    ok,
    at: new Date(nowMs).toISOString(),
  }
}

const ORDER_HINT_RE = /\b(ORDER[-_\s]?[A-Z0-9]+|ORD[-_\s]?\d+|pedido\s*#?\s*([A-Z0-9-]+))\b/i

export function extractOrderHint(text: string): string | null {
  const m = text.match(ORDER_HINT_RE)
  if (!m) return null
  return (m[1] || m[2] || '').replace(/\s+/g, '-').toUpperCase()
}

export async function runCreateOrLinkOrder(ctx: SoftAiToolContext): Promise<SoftAiToolOutcome> {
  const tool: SoftAiToolName = 'create_or_link_order'
  if (!isToolAllowed(ctx.config, tool)) {
    return {
      log: logEntry(tool, {}, { error: 'tool_not_allowed' }, false, ctx.nowMs),
      tags: ctx.tags,
      orderId: ctx.orderId,
    }
  }

  const blob = ctx.input.messages
    .slice(-8)
    .map((m) => m.content)
    .join(' ')
  const hint = extractOrderHint(blob) || extractOrderHint(ctx.input.inboundText || '')

  if (ctx.input.demo) {
    const demoOrderId = ctx.orderId || `DEMO-${hint || `ORD-${String(ctx.nowMs).slice(-6)}`}`
    return {
      log: logEntry(
        tool,
        { hint, demo: true },
        {
          orderId: demoOrderId,
          orderNumber: demoOrderId,
          linked: Boolean(ctx.orderId),
          created: !ctx.orderId,
          note: 'DEMO stub — no production Order row written',
        },
        true,
        ctx.nowMs,
      ),
      tags: ctx.tags.includes('Nuevo') ? ctx.tags : ([...ctx.tags, 'Nuevo'] as SoftTag[]),
      orderId: demoOrderId,
      replyHint: `Tu pedido quedó vinculado como ${demoOrderId}.`,
    }
  }

  if (ctx.deps?.findOrder) {
    const found = await ctx.deps.findOrder({ orderId: ctx.orderId, orderNumberHint: hint })
    if (found) {
      return {
        log: logEntry(
          tool,
          { hint },
          { orderId: found.id, orderNumber: found.orderNumber, linked: true },
          true,
          ctx.nowMs,
        ),
        tags: ctx.tags,
        orderId: found.id,
        replyHint: `Encontré tu pedido ${found.orderNumber}.`,
      }
    }
  }

  // Honest stub when no DB match / no deps — do not invent production orders
  const stubId = ctx.orderId || (hint ? `LINK-${hint}` : null)
  return {
    log: logEntry(
      tool,
      { hint },
      {
        orderId: stubId,
        stub: true,
        note: 'TODO: persist Order via ventas lifecycle when Soft AI create is enabled for tenant',
      },
      Boolean(stubId),
      ctx.nowMs,
    ),
    tags: ctx.tags,
    orderId: stubId,
    replyHint: stubId
      ? `Registré la referencia ${stubId}; un humano confirma el alta si falta.`
      : 'Necesito el número de pedido o más datos para vincularlo.',
  }
}

export async function runGetOrderStatus(ctx: SoftAiToolContext): Promise<SoftAiToolOutcome> {
  const tool: SoftAiToolName = 'get_order_status'
  if (!isToolAllowed(ctx.config, tool)) {
    return {
      log: logEntry(tool, {}, { error: 'tool_not_allowed' }, false, ctx.nowMs),
      tags: ctx.tags,
      orderId: ctx.orderId,
    }
  }

  if (ctx.input.demo && ctx.orderId) {
    return {
      log: logEntry(
        tool,
        { orderId: ctx.orderId },
        { status: 'en_preparacion', demo: true },
        true,
        ctx.nowMs,
      ),
      tags: ctx.tags,
      orderId: ctx.orderId,
      replyHint: `El pedido ${ctx.orderId} está en preparación.`,
    }
  }

  if (ctx.deps?.findOrder && ctx.orderId) {
    const found = await ctx.deps.findOrder({ orderId: ctx.orderId })
    if (found) {
      return {
        log: logEntry(
          tool,
          { orderId: ctx.orderId },
          { status: found.status, orderNumber: found.orderNumber },
          true,
          ctx.nowMs,
        ),
        tags: ctx.tags,
        orderId: found.id,
        replyHint: `Tu pedido ${found.orderNumber} está en estado: ${found.status}.`,
      }
    }
  }

  return {
    log: logEntry(
      tool,
      { orderId: ctx.orderId },
      { status: 'unknown', stub: true },
      false,
      ctx.nowMs,
    ),
    tags: ctx.tags,
    orderId: ctx.orderId,
    replyHint: 'Todavía no tengo el estado exacto; lo reviso con el equipo.',
  }
}

export async function runCorreosGuia(ctx: SoftAiToolContext): Promise<SoftAiToolOutcome> {
  const tool: SoftAiToolName = 'correos_guia'
  if (!isToolAllowed(ctx.config, tool)) {
    return {
      log: logEntry(tool, {}, { error: 'tool_not_allowed' }, false, ctx.nowMs),
      tags: ctx.tags,
      orderId: ctx.orderId,
    }
  }

  const nextTags = ctx.tags.includes('Envío')
    ? ctx.tags
    : ([...ctx.tags, 'Envío'] as SoftTag[])

  if (ctx.input.demo) {
    const guia = `CR-DEMO-${String(ctx.nowMs).slice(-8)}`
    return {
      log: logEntry(
        tool,
        { orderId: ctx.orderId },
        {
          guiaNumber: guia,
          source: 'stub',
          note: 'DEMO stub — not a live Correos guía. Real path: ShippingGuia + CorreosWebService.trackShipment',
        },
        true,
        ctx.nowMs,
      ),
      tags: nextTags,
      orderId: ctx.orderId,
      replyHint: `Tu número de guía (DEMO) es ${guia}. Podés rastrearlo en Correos cuando esté activo.`,
    }
  }

  if (ctx.deps?.findGuia) {
    const found = await ctx.deps.findGuia({ orderId: ctx.orderId })
    if (found) {
      return {
        log: logEntry(
          tool,
          { orderId: ctx.orderId },
          {
            guiaNumber: found.guiaNumber,
            status: found.status,
            carrier: found.carrier,
            source: found.source,
          },
          true,
          ctx.nowMs,
        ),
        tags: nextTags,
        orderId: ctx.orderId,
        replyHint: `Tu guía es ${found.guiaNumber}${found.status ? ` (${found.status})` : ''}.`,
      }
    }
  }

  // Honest stub — clear TODO for live Correos when no DB row
  return {
    log: logEntry(
      tool,
      { orderId: ctx.orderId },
      {
        stub: true,
        source: 'stub',
        note: 'TODO: ShippingGuia by orderId, then CorreosWebService.trackShipment(guia)',
      },
      false,
      ctx.nowMs,
    ),
    tags: nextTags,
    orderId: ctx.orderId,
    replyHint:
      'Aún no tengo la guía publicada en Correos; te la paso en cuanto salga (suele ser 1–2h post despacho).',
  }
}

export async function runTagChat(
  ctx: SoftAiToolContext,
  tag: SoftTag,
): Promise<SoftAiToolOutcome> {
  const tool: SoftAiToolName = 'tag_chat'
  if (!isToolAllowed(ctx.config, tool)) {
    return {
      log: logEntry(tool, { tag }, { error: 'tool_not_allowed' }, false, ctx.nowMs),
      tags: ctx.tags,
      orderId: ctx.orderId,
    }
  }
  const next = ctx.tags.includes(tag) ? ctx.tags : ([...ctx.tags, tag] as SoftTag[])
  return {
    log: logEntry(tool, { tag }, { tags: next }, true, ctx.nowMs),
    tags: next,
    orderId: ctx.orderId,
  }
}

export async function runEscalateToHuman(
  ctx: SoftAiToolContext,
  reason: string,
): Promise<SoftAiToolOutcome> {
  const tool: SoftAiToolName = 'escalate_to_human'
  if (!isToolAllowed(ctx.config, tool)) {
    return {
      log: logEntry(tool, { reason }, { error: 'tool_not_allowed' }, false, ctx.nowMs),
      tags: ctx.tags,
      orderId: ctx.orderId,
      escalate: true,
      escalateReason: reason,
    }
  }
  return {
    log: logEntry(tool, { reason }, { escalated: true }, true, ctx.nowMs),
    tags: ctx.tags,
    orderId: ctx.orderId,
    escalate: true,
    escalateReason: reason,
    replyHint:
      'Te paso con una persona del equipo para ayudarte con eso. Quedan al tanto de este chat.',
  }
}
