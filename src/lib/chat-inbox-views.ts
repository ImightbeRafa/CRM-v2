/**
 * /chats quick views (Rafael 2026-10-18): "Persona", "Revisar pago", "Pedido por confirmar", "IA atendiendo" and
 * "Seguimientos". Pure: the same rules decide the list (client, on the loaded rows) and the counts (server SQL in
 * chat-inbox-views-server.ts), so a tab's number and its rows agree. Every view is open chats only.
 */
import { ORDER_REVIEW_TAG, PAYMENT_REVIEW_TAG } from '@/lib/crm-stages'

export type InboxView = 'todos' | 'persona' | 'pago' | 'pedido' | 'ia' | 'seguimientos'
export type InboxCountedView = Exclude<InboxView, 'todos'>

export const INBOX_COUNTED_VIEWS: InboxCountedView[] = ['persona', 'pago', 'pedido', 'ia', 'seguimientos']

export const INBOX_VIEW_DEFS: Array<{ id: InboxView; label: string; emoji: string }> = [
  { id: 'todos', label: 'Todos', emoji: '' },
  { id: 'persona', label: 'Persona', emoji: '👤' },
  { id: 'pago', label: 'Revisar pago', emoji: '💳' },
  { id: 'pedido', label: 'Pedido por confirmar', emoji: '📦' },
  { id: 'ia', label: 'IA atendiendo', emoji: '✦' },
  { id: 'seguimientos', label: 'Seguimientos', emoji: '↻' },
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
}

export function isPersonAiMode(mode: string | null | undefined): boolean {
  return Boolean(mode && (PERSON_AI_MODES as readonly string[]).includes(mode))
}

export function matchesInboxView(row: InboxViewRow, view: InboxView): boolean {
  if (view === 'todos') return true
  if (row.closed) return false
  switch (view) {
    case 'persona':
      return isPersonAiMode(row.aiMode)
    case 'pago':
      return row.tags.includes(PAYMENT_REVIEW_TAG)
    case 'pedido':
      return row.tags.includes(ORDER_REVIEW_TAG)
    case 'ia':
      return (
        row.lineAiOn &&
        !isPersonAiMode(row.aiMode) &&
        !row.tags.includes(PAYMENT_REVIEW_TAG) &&
        !row.tags.includes(ORDER_REVIEW_TAG)
      )
    case 'seguimientos':
      return row.lastMessageDirection === 'outbound' && row.lastIsFollowUp === true
  }
}

export type InboxViewCounts = Record<InboxCountedView, number>

export function emptyInboxViewCounts(): InboxViewCounts {
  return { persona: 0, pago: 0, pedido: 0, ia: 0, seguimientos: 0 }
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

/** "Persona": who waits longest comes first (oldest customer message on top). Other views keep the list order. */
export function sortForInboxView<T extends { lastInboundAt?: string | null; lastMessageAt: string }>(
  rows: T[],
  view: InboxView,
): T[] {
  if (view !== 'persona') return rows
  const at = (r: T) => r.lastInboundAt || r.lastMessageAt
  return [...rows].sort((a, b) => at(a).localeCompare(at(b)))
}
