/**
 * /chats quick views: "Sin responder" (the customer is waiting on us), "Persona", "Revisar pago", "Pedido"
 * (open orders), "IA atendiendo" and "Seguimientos". Pure: the same rules decide the list (client, on the loaded rows) and the counts (server SQL in
 * chat-inbox-views-server.ts), so a tab's number and its rows agree. Every view is open chats only.
 * Pedido uses `hasOpenOrder` from the list (an order that is not delivered or cancelled), not the review tag.
 */
import { isClosedCategory, ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG, type StageCategory } from '@/lib/crm-stages'

export type InboxView = 'todos' | 'sin_responder' | 'persona' | 'pago' | 'pedido' | 'ia' | 'seguimientos'
export type InboxCountedView = Exclude<InboxView, 'todos'>

export const INBOX_COUNTED_VIEWS: InboxCountedView[] = ['sin_responder', 'persona', 'pago', 'pedido', 'ia', 'seguimientos']

export const INBOX_VIEW_DEFS: Array<{ id: InboxView; label: string; short: string; emoji: string }> = [
  { id: 'todos', label: 'Bandeja', short: 'Bandeja', emoji: '' },
  { id: 'sin_responder', label: 'Sin responder (el cliente espera)', short: 'Sin responder', emoji: '⏳' },
  { id: 'persona', label: 'Persona (chats con alguien del equipo)', short: 'Persona', emoji: '👤' },
  { id: 'pago', label: 'Revisar pago', short: 'Revisar pago', emoji: '💳' },
  { id: 'pedido', label: 'Pedidos abiertos (no entregados ni cancelados)', short: 'Pedido', emoji: '📦' },
  { id: 'ia', label: 'IA atendiendo', short: 'IA', emoji: '✦' },
  { id: 'seguimientos', label: 'Seguimientos sin respuesta', short: 'Seguimientos', emoji: '↻' },
]

/** aiMode values that mean a person has the chat (agent hand-off sets 'human'; legacy 'human_takeover'). */
export const PERSON_AI_MODES = ['human', 'paused', 'human_takeover'] as const

export const INBOX_VIEW_STORAGE_KEY = 'betsy.chats.view.v1'

export function parseInboxView(raw: string | null | undefined): InboxView {
  return INBOX_VIEW_DEFS.some((v) => v.id === raw) ? (raw as InboxView) : 'todos'
}

/** The fields a view looks at (list DTO subset). */
export type InboxViewRow = {
  aiMode: string | null
  tags: string[]
  lastMessageDirection: string | null
  /** The newest message is our follow-up / reactivation send (metadata.followUp). */
  lastIsFollowUp?: boolean
  /** The chat's line has the AI on (dto.aiLine.state === 'on'). */
  lineAiOn: boolean
  closed: boolean
  /** This chat has an order that is still open (paid or waiting; not delivered or cancelled). */
  hasOpenOrder?: boolean
  /** The agent's last reply left it to a person (safe line / hand-off / provider failure), nobody wrote since. */
  needsPerson?: boolean
}

/** The customer is waiting on us: wrote last, or the agent left the chat to a person. */
export function isWaitingOnUs(row: { lastMessageDirection: string | null; needsPerson?: boolean }): boolean {
  return row.lastMessageDirection === 'inbound' || row.needsPerson === true
}

export function isPersonAiMode(mode: string | null | undefined): boolean {
  return Boolean(mode && (PERSON_AI_MODES as readonly string[]).includes(mode))
}

export function matchesInboxView(row: InboxViewRow, view: InboxView): boolean {
  if (view === 'todos') return true
  if (row.closed) return false
  switch (view) {
    case 'sin_responder':
      return isWaitingOnUs(row)
    case 'persona':
      return isPersonAiMode(row.aiMode)
    case 'pago':
      return row.tags.includes(PAYMENT_REVIEW_TAG)
    case 'pedido':
      return row.hasOpenOrder === true
    case 'ia':
      return (
        row.lineAiOn &&
        !isPersonAiMode(row.aiMode) &&
        // Left to a person by the agent: not "IA atendiendo" (it is in Sin responder).
        row.needsPerson !== true &&
        !row.tags.includes(PAYMENT_REVIEW_TAG) &&
        !row.tags.includes(ORDER_REVIEW_TAG)
      )
    case 'seguimientos':
      return row.lastMessageDirection === 'outbound' && row.lastIsFollowUp === true
    default: {
      const exhaustive: never = view
      return exhaustive
    }
  }
}

export type InboxViewCounts = Record<InboxCountedView, number>

export function emptyInboxViewCounts(): InboxViewCounts {
  return { sin_responder: 0, persona: 0, pago: 0, pedido: 0, ia: 0, seguimientos: 0 }
}

/** Sums the per-line counts for the lines the list shows (channel / line filter). */
export function sumInboxViewCounts(
  byAccount: Record<string, Partial<InboxViewCounts>>,
  accountIds: Iterable<string> | null,
): InboxViewCounts {
  const out = emptyInboxViewCounts()
  const keys = accountIds ? [...accountIds] : Object.keys(byAccount)
  for (const id of keys) {
    const row = byAccount[id]
    if (!row) continue
    for (const v of INBOX_COUNTED_VIEWS) out[v] += Number(row[v]) || 0
  }
  return out
}

/**
 * Every view is newest activity first (Rafael 2026-10-22). "Seguimientos" orders by the follow-up send itself (a
 * follow-up keeps the chat's place in the Bandeja on purpose, so its list time is the older message).
 */
export function sortForInboxView<
  T extends { lastMessageAt: string; lastOutboundAt?: string | null; id?: string },
>(rows: T[], view: InboxView): T[] {
  const at = (r: T) => (view === 'seguimientos' && r.lastOutboundAt ? r.lastOutboundAt : r.lastMessageAt)
  return [...rows].sort((a, b) => at(b).localeCompare(at(a)) || String(b.id ?? '').localeCompare(String(a.id ?? '')))
}

/** How long the customer has waited, for the "Sin responder" badge: tone grows with the wait. */
export function waitTone(sinceIso: string | null | undefined, now = Date.now()): 'fresh' | 'warn' | 'late' {
  const since = sinceIso ? Date.parse(sinceIso) : NaN
  if (!Number.isFinite(since)) return 'fresh'
  const minutes = (now - since) / 60_000
  return minutes >= 240 ? 'late' : minutes >= 60 ? 'warn' : 'fresh'
}

/** The view fields of a list row (DTO). */
export function inboxViewRowFromDto(d: {
  aiMode: string | null
  tags: string[]
  lastMessageDirection: string | null
  lastIsFollowUp?: boolean
  aiLine?: { state: string } | null
  stageCategory?: StageCategory | null
  hasOpenOrder?: boolean
  needsPerson?: boolean
}): InboxViewRow {
  return {
    aiMode: d.aiMode,
    tags: d.tags || [],
    lastMessageDirection: d.lastMessageDirection,
    lastIsFollowUp: d.lastIsFollowUp,
    lineAiOn: d.aiLine?.state === 'on',
    hasOpenOrder: d.hasOpenOrder === true,
    needsPerson: d.needsPerson === true,
    closed: isClosedCategory(d.stageCategory ?? 'open'),
  }
}
