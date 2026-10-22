/**
 * Outbound event contract for the Advance "Ticket" Grok agent (SPEC §5).
 * Pure module (node:crypto only). The DB dispatcher lives in `dispatcher.ts`.
 *
 * The body keeps Advance IANAI `buildTicketCreatedPayload` keys and types
 * exactly (`event` + `ticket{id,subject,description,category,priority,status,
 * user_email,page_url,created_at}`) and adds `source: "betsy"` + `betsy{}`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { clip, maskEmail, redactSecrets, scrubPageUrl } from './redact'
import {
  SUPPORT_LIMITS,
  formatTicketRef,
  toAdvancePriority,
  type SupportEventType,
} from './types'

export type SupportEventTicketInput = {
  id: string
  number: number | bigint
  subject: string
  /** First customer message (or the reply that triggered the event). */
  description: string
  category: string
  priority: string
  status: string
  source: string
  contactEmail: string | null
  contactName: string | null
  pageUrl: string | null
  phone: string | null
  createdAt: Date | string
  tenant: { id: string; name: string; plan: string | null } | null
}

export type SupportEventPayload = {
  event: SupportEventType
  source: 'betsy'
  ticket: {
    id: string
    subject: string
    description: string
    category: string
    priority: string
    status: string
    user_email: string | null
    page_url: string | null
    created_at: string | null
  }
  betsy: {
    ref: string
    channel: string
    delivery_id: string
    tenant: { id: string; name: string; plan: string | null } | null
    contact_name: string | null
    phone: string | null
    mcp_url: string
    admin_url: string
  }
}

export function buildTicketEventPayload(
  type: SupportEventType,
  ticket: SupportEventTicketInput,
  opts: { deliveryId: string; baseUrl: string },
): SupportEventPayload {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const created =
    ticket.createdAt instanceof Date ? ticket.createdAt.toISOString() : ticket.createdAt || null
  return {
    event: type,
    source: 'betsy',
    ticket: {
      id: String(ticket.id),
      subject: clip(redactSecrets(ticket.subject || ''), SUPPORT_LIMITS.subject),
      description: clip(redactSecrets(ticket.description || ''), SUPPORT_LIMITS.payloadDescription),
      category: String(ticket.category || 'other'),
      priority: toAdvancePriority(String(ticket.priority || 'normal')),
      status: String(ticket.status || 'open'),
      // SPEC §9: never push the full email; the agent reads it via MCP support_get_ticket.
      user_email: maskEmail(ticket.contactEmail),
      page_url: scrubPageUrl(ticket.pageUrl),
      created_at: created,
    },
    betsy: {
      ref: formatTicketRef(ticket.number),
      channel: ticket.source,
      delivery_id: opts.deliveryId,
      tenant: ticket.tenant
        ? { id: ticket.tenant.id, name: clip(ticket.tenant.name, 120), plan: ticket.tenant.plan }
        : null,
      contact_name: ticket.contactName ? clip(ticket.contactName, SUPPORT_LIMITS.name) : null,
      // Phone is customer PII; only the presence is pushed, the agent reads it via MCP.
      phone: ticket.phone ? '[via MCP]' : null,
      mcp_url: `${base}/api/mcp`,
      admin_url: `${base}/super-admin/soporte/${encodeURIComponent(ticket.id)}`,
    },
  }
}

/** `sha256=<hex>` over `${timestamp}.${rawBody}` (SPEC §5 optional hardening). */
export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`
}

export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, timestamp, rawBody))
  const got = Buffer.from(String(signature || ''))
  return expected.length === got.length && timingSafeEqual(expected, got)
}

/** Retry delays after attempt N fails (1m, 5m, 30m, 2h, 12h), then give up. */
export const SUPPORT_RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const
export const SUPPORT_MAX_ATTEMPTS = SUPPORT_RETRY_DELAYS_MS.length + 1

/** Next attempt time after `attempts` failures, or null = give up (`failed`). */
export function nextAttemptAfter(attempts: number, now: Date = new Date()): Date | null {
  if (attempts < 1 || attempts > SUPPORT_RETRY_DELAYS_MS.length) return null
  return new Date(now.getTime() + SUPPORT_RETRY_DELAYS_MS[attempts - 1])
}

/** `SUPPORT_WEBHOOK_EVENTS` (comma list, default `ticket.created`). */
export function parseWebhookEvents(raw: string | undefined | null): Set<string> {
  const list = (raw ?? 'ticket.created')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return new Set(list.length ? list : ['ticket.created'])
}

/** Advance `parseSinceParam`: ISO → Date, else now − fallback (15 min). */
export function parseSinceParam(value: unknown, fallbackMs = 15 * 60 * 1000): Date {
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date(Date.now() - fallbackMs)
}
