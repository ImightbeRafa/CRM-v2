/**
 * Soft Tenant AI types — CRM customer inbox agent (not staff bot).
 * Monitor + Take over / Pause / Resume. Not suggest-first.
 */

import type { SoftTag } from '@/lib/chat-soft-copilot'

/** Per-thread agent control mode. */
export type SoftAiAgentMode = 'ai_active' | 'paused' | 'human'

export type SoftAiToolName =
  | 'create_or_link_order'
  | 'get_order_status'
  | 'correos_guia'
  | 'tag_chat'
  | 'escalate_to_human'

export const SOFT_AI_ALL_TOOLS: SoftAiToolName[] = [
  'create_or_link_order',
  'get_order_status',
  'correos_guia',
  'tag_chat',
  'escalate_to_human',
]

export type SoftAiToolLogEntry = {
  id: string
  tool: SoftAiToolName
  args: Record<string, unknown>
  result: Record<string, unknown>
  ok: boolean
  at: string
}

export type SoftAiConfig = {
  /** Short Spanish personality for the tenant agent. */
  personality: string
  /** Knowledge-base snippets (FAQ / policies). */
  kb: string[]
  /** Tools the agent may call. */
  toolAllowlist: SoftAiToolName[]
  /**
   * Payments / SINPE / money always escalate to human.
   * Default true — never auto-handle money.
   */
  paymentAlwaysHuman: boolean
}

export type SoftAiTurnMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  content: string
  sentAt: string
  orderId?: string | null
}

export type SoftAiTurnInput = {
  conversationKey: string
  recipientId: string
  recipientName?: string | null
  platform: string
  messages: SoftAiTurnMessage[]
  /** Latest inbound that triggered the turn (optional). */
  inboundText?: string
  agentMode: SoftAiAgentMode
  config: SoftAiConfig
  /** Existing tags on the thread. */
  tags: SoftTag[]
  /** Linked order id if any. */
  orderId?: string | null
  /** Demo path: never touch production DB / Meta. */
  demo?: boolean
  nowMs?: number
}

export type SoftAiTurnResult = {
  skipped: boolean
  skipReason?: 'flag_off' | 'paused' | 'human' | 'payment_escalation' | 'empty'
  reply: string | null
  toolLog: SoftAiToolLogEntry[]
  /** Mode after tools (may escalate to human). */
  agentMode: SoftAiAgentMode
  tags: SoftTag[]
  orderId: string | null
  /** True when payment/SINPE cues forced escalate. */
  paymentBlocked: boolean
}

export const DEFAULT_SOFT_AI_CONFIG: SoftAiConfig = {
  personality:
    'Sos el agente de atención de Betsy. Español de Costa Rica, claro y breve. Resolvé pedidos, guías y dudas sin inventar precios de pago.',
  kb: [
    'Envíos Correos de Costa Rica: la guía se publica 1–2h después del despacho.',
    'Kits: confirmar provincia para cotizar envío. No cobrar SINPE automáticamente.',
    'Pagos / SINPE / transferencias: siempre pasar a un humano.',
  ],
  toolAllowlist: [...SOFT_AI_ALL_TOOLS],
  paymentAlwaysHuman: true,
}
