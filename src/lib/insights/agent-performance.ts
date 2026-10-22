/**
 * "Know what sells" (Lane E2) · per-agent performance. Pure (no DB).
 *
 * Inputs are live turns only (tests / Probar excluded upstream) and the chat-linked orders of the period.
 * - Chats handled: distinct chats where the agent produced a turn. Replies: turns delivered to the customer.
 * - Hand-offs: turns whose outcome markers say 'handoff' (a person takes the chat) or 'review'
 *   (the chat stays on IA, a person is asked to look), grouped by reason code.
 * - Sales: chat-linked orders where the agent replied in that chat before the order was created, counting
 *   only turns after the chat's previous order and within the attribution window (7 days), so old
 *   conversations never get credit for a repeat order.
 *   "La IA cerró": the agent's last hand-off before the order was the sale hand-off (order ready /
 *   payment): the agent got the customer to the order and a person only confirmed it.
 *   "IA + persona": the agent replied but the team had to take over for another reason.
 * - Response time: from the customer's message (the turn's trigger) to the first message of the reply
 *   reaching the chat. Includes the configured reply pause and waits outside business hours.
 * - Provider errors: turns that failed because the AI provider failed (LLM_*), e.g. no credit / timeout.
 */

import { median, money, percentile, rate } from '@/lib/insights/stats-math'

export type AgentTurnFact = {
  agentId: string
  conversationId: string | null
  status: string
  errorCode: string | null
  costMicros: number
  /** When the customer's message (the trigger) was sent; null when unknown. */
  triggerAt: Date | null
  /** When the reply was sent (first message of the turn), else completedAt / createdAt. */
  doneAt: Date
  handoffKind: 'handoff' | 'review' | null
  handoffReason: string | null
}

export type AgentOrderFact = {
  orderId: string
  conversationId: string
  createdAt: Date
  total: number | null
  collected: boolean
  cancelled: boolean
  /** The previous linked order of the same chat (its timestamp), if any. */
  previousOrderAt?: Date | null
}

export const SALE_WINDOW_DAYS = 7

export type AgentPerformance = {
  agentId: string
  chats: number
  replies: number
  handoffs: number
  reviews: number
  handoffReasons: Array<{ reason: string; count: number }>
  salesByAgent: number
  salesWithHuman: number
  soldByAgent: number
  soldWithHuman: number
  collected: number
  costMicros: number
  costPerSaleMicros: number | null
  responseMedianMs: number | null
  responseP90Ms: number | null
  providerErrors: number
  handoffRate: number | null
}

/** Reason codes that mean "the agent got the customer to the order / payment" (the sale hand-off). */
export const SALE_HANDOFF_REASONS = new Set(['order_ready', 'order_ready_cash', 'payment', 'payment_details'])

const PROVIDER_ERROR_CODES = new Set(['LLM_ERROR', 'LLM_TIMEOUT', 'LLM_AUTH', 'LLM_NOT_CONFIGURED', 'PROVIDER_NOT_CONFIGURED'])

export function isProviderError(code: string | null | undefined): boolean {
  return Boolean(code && PROVIDER_ERROR_CODES.has(code))
}

/** Delivered = the customer got the text. */
export function isDeliveredTurn(status: string): boolean {
  return status === 'delivered'
}

/** Plain Spanish for hand-off reason codes (HANDOFF_REASON in soft-ai/agent-turn-outcome.ts). Unknown → generic. */
export const HANDOFF_REASON_LABELS: Record<string, string> = {
  payment: 'Comprobante o pago',
  payment_details: 'Datos de pago',
  complaint: 'Reclamo o devolución',
  human_request: 'Pidió hablar con una persona',
  owner_reply: 'Respuesta del dueño',
  escalate: 'La IA pidió ayuda',
  review: 'Revisión del equipo',
  order_ready: 'Pedido listo (contra entrega)',
  order_ready_cash: 'Pedido listo (efectivo)',
}

export function handoffReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Sin motivo'
  return HANDOFF_REASON_LABELS[reason] ?? 'Otro motivo'
}

function emptyPerf(agentId: string): AgentPerformance {
  return {
    agentId,
    chats: 0,
    replies: 0,
    handoffs: 0,
    reviews: 0,
    handoffReasons: [],
    salesByAgent: 0,
    salesWithHuman: 0,
    soldByAgent: 0,
    soldWithHuman: 0,
    collected: 0,
    costMicros: 0,
    costPerSaleMicros: null,
    responseMedianMs: null,
    responseP90Ms: null,
    providerErrors: 0,
    handoffRate: null,
  }
}

/** Who made the sale of one order: 'agent', 'agent_human', or null (the agent never replied before it). */
export function classifyOrderSale(
  order: Pick<AgentOrderFact, 'createdAt' | 'previousOrderAt'>,
  turns: readonly AgentTurnFact[],
  windowDays = SALE_WINDOW_DAYS,
): { kind: 'agent' | 'agent_human'; agentId: string } | null {
  const at = order.createdAt.getTime()
  const since = Math.max(at - windowDays * 86_400_000, order.previousOrderAt ? order.previousOrderAt.getTime() : -Infinity)
  const scoped = turns.filter((t) => t.doneAt.getTime() <= at && t.doneAt.getTime() > since)
  const delivered = scoped.filter((t) => isDeliveredTurn(t.status)).sort((a, b) => a.doneAt.getTime() - b.doneAt.getTime())
  if (delivered.length === 0) return null
  const lastHandoff = scoped
    .filter((t) => t.handoffKind === 'handoff')
    .sort((a, b) => b.doneAt.getTime() - a.doneAt.getTime())[0]
  if (lastHandoff?.handoffReason && SALE_HANDOFF_REASONS.has(lastHandoff.handoffReason)) {
    return { kind: 'agent', agentId: lastHandoff.agentId }
  }
  return { kind: 'agent_human', agentId: delivered[delivered.length - 1].agentId }
}

export function buildAgentPerformance(input: {
  turns: readonly AgentTurnFact[]
  orders: readonly AgentOrderFact[]
  /** Turns of the involved chats from BEFORE the period too (a sale may follow last week's chat). */
  historyTurns?: readonly AgentTurnFact[]
}): AgentPerformance[] {
  const perf = new Map<string, AgentPerformance>()
  const get = (agentId: string) => {
    let row = perf.get(agentId)
    if (!row) {
      row = emptyPerf(agentId)
      perf.set(agentId, row)
    }
    return row
  }
  const chats = new Map<string, Set<string>>()
  const reasons = new Map<string, Map<string, number>>()
  const responses = new Map<string, number[]>()

  for (const t of input.turns) {
    const row = get(t.agentId)
    row.costMicros += Number.isFinite(t.costMicros) && t.costMicros > 0 ? t.costMicros : 0
    if (t.conversationId) {
      const set = chats.get(t.agentId) ?? new Set<string>()
      set.add(t.conversationId)
      chats.set(t.agentId, set)
    }
    if (isProviderError(t.errorCode)) row.providerErrors += 1
    if (isDeliveredTurn(t.status)) {
      row.replies += 1
      if (t.triggerAt) {
        const ms = t.doneAt.getTime() - t.triggerAt.getTime()
        // A trigger older than a day is a follow-up / sweep, not a response time.
        if (ms >= 0 && ms <= 86_400_000) {
          const list = responses.get(t.agentId) ?? []
          list.push(ms)
          responses.set(t.agentId, list)
        }
      }
    }
    if (t.handoffKind) {
      if (t.handoffKind === 'handoff') row.handoffs += 1
      else row.reviews += 1
      const key = t.handoffReason || 'unknown'
      const m = reasons.get(t.agentId) ?? new Map<string, number>()
      m.set(key, (m.get(key) ?? 0) + 1)
      reasons.set(t.agentId, m)
    }
  }

  // Sales: every turn we know for the order's chat (period + history), never double-counting an order.
  const allTurns = [...input.turns, ...(input.historyTurns ?? [])]
  const turnsByChat = new Map<string, AgentTurnFact[]>()
  for (const t of allTurns) {
    if (!t.conversationId) continue
    const list = turnsByChat.get(t.conversationId) ?? []
    list.push(t)
    turnsByChat.set(t.conversationId, list)
  }
  const seen = new Set<string>()
  for (const order of input.orders) {
    if (order.cancelled || seen.has(order.orderId)) continue
    seen.add(order.orderId)
    const sale = classifyOrderSale(order, turnsByChat.get(order.conversationId) ?? [])
    if (!sale) continue
    const row = get(sale.agentId)
    const total = money(order.total)
    if (sale.kind === 'agent') {
      row.salesByAgent += 1
      row.soldByAgent += total
    } else {
      row.salesWithHuman += 1
      row.soldWithHuman += total
    }
    if (order.collected) row.collected += total
  }

  for (const row of perf.values()) {
    row.chats = chats.get(row.agentId)?.size ?? 0
    const list = responses.get(row.agentId) ?? []
    row.responseMedianMs = median(list)
    row.responseP90Ms = percentile(list, 0.9)
    const sales = row.salesByAgent + row.salesWithHuman
    row.costPerSaleMicros = sales > 0 ? Math.round(row.costMicros / sales) : null
    row.handoffRate = rate(row.handoffs, row.chats)
    row.handoffReasons = [...(reasons.get(row.agentId) ?? new Map()).entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
  }
  return [...perf.values()].sort((a, b) => b.replies - a.replies || a.agentId.localeCompare(b.agentId))
}

/** USD micros → USD. */
export function microsToUsd(micros: number | null): number | null {
  if (micros === null || !Number.isFinite(micros)) return null
  return micros / 1_000_000
}
