/**
 * Support pipeline vocabulary (docs/plans/support-pipeline/SPEC.md §3).
 * Pure module: no Prisma, no env, safe to import from tests and client code.
 */

export const SUPPORT_SOURCES = ['contact_form', 'in_app', 'ai_chat', 'email', 'agent_request'] as const
export type SupportTicketSource = (typeof SUPPORT_SOURCES)[number]

export const SUPPORT_CATEGORIES = ['bug', 'billing', 'question', 'feature', 'agent_request', 'other'] as const
export type SupportTicketCategory = (typeof SUPPORT_CATEGORIES)[number]

export const SUPPORT_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const
export type SupportTicketPriority = (typeof SUPPORT_PRIORITIES)[number]

export const SUPPORT_STATUSES = [
  'open',
  'ai_answered',
  'waiting_customer',
  'escalated',
  'resolved',
  'closed',
  'spam',
] as const
export type SupportTicketStatus = (typeof SUPPORT_STATUSES)[number]

export const SUPPORT_AUTHORS = ['customer', 'grok_agent', 'rafael', 'system'] as const
export type SupportMessageAuthor = (typeof SUPPORT_AUTHORS)[number]

export const SUPPORT_VISIBILITIES = ['public', 'internal'] as const
export type SupportMessageVisibility = (typeof SUPPORT_VISIBILITIES)[number]

export const SUPPORT_EVENT_TYPES = ['ticket.created', 'ticket.customer_replied', 'ticket.escalated'] as const
export type SupportEventType = (typeof SUPPORT_EVENT_TYPES)[number]

export const SUPPORT_ASSIGNEES = ['grok_agent', 'rafael'] as const
export type SupportAssignee = (typeof SUPPORT_ASSIGNEES)[number]

/** Delivery state of one outbox leg (webhook or email). */
export type SupportDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped'

export const SUPPORT_LIMITS = {
  name: 120,
  subject: 200,
  messageMin: 10,
  messageMax: 5000,
  /** Stored message bodies (agent replies, internal notes). */
  bodyMax: 10_000,
  /** Description pushed to the agent webhook. */
  payloadDescription: 2000,
} as const

export const AGENT_REQUEST_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'web'] as const
export type AgentRequestChannel = (typeof AGENT_REQUEST_CHANNELS)[number]

/** Non-PII request context stored on the ticket (never the raw IP). */
export type SupportTicketMeta = {
  pageUrl?: string | null
  locale?: string | null
  userAgent?: string | null
  ipHash?: string | null
  phone?: string | null
  spamReasons?: string[]
  [key: string]: unknown
}

export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value)
}

/** Human ref shown to customers and in email subjects. */
export function formatTicketRef(number: number | bigint | string): string {
  return `BETSY-${String(number)}`
}

/** Parses `BETSY-1042` / `betsy-1042` / `1042` into 1042, else null. */
export function parseTicketRef(ref: unknown): number | null {
  if (typeof ref !== 'string' && typeof ref !== 'number') return null
  const m = /^(?:betsy-)?(\d{1,12})$/i.exec(String(ref).trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** Betsy priority → Advance vocabulary (`normal` → `medium`). */
export function toAdvancePriority(priority: string): string {
  return priority === 'normal' ? 'medium' : priority
}
