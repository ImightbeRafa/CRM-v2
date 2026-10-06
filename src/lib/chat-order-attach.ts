import { normalizeClientPhone } from '@/lib/order-lifecycle'

/**
 * Chats › Cliente › "Vincular pedido": attach an existing order (e.g. one that came from the
 * website) to a chat. The link itself is the existing `ChatMessage.orderId` FK (same as
 * "Crear pedido" from the chat and POST /api/chat/order-link). Pure helpers + their tests.
 */

/**
 * Costa Rica numbers only: 8 digits, or 11 starting with 506 ("+506 8814-8939", "8814-8939").
 * Other countries (+505, +507…) also use 8 digits, so they never match by the last 8.
 */
export function phoneTail(raw: unknown): string | null {
  const digits = normalizeClientPhone(raw)
  return digits && /^\d{8}$/.test(digits) ? digits : null
}

/** Search box digits → order phone digits to look for (a full CR number matches without +506). */
export function searchPhoneDigits(digits: string): string {
  return phoneTail(digits) ?? digits
}

/** Distinct, valid tails (chat peer phone, linked client phone…). */
export function phoneTails(values: unknown[]): string[] {
  const out = new Set<string>()
  for (const v of values) {
    const t = phoneTail(v)
    if (t) out.add(t)
  }
  return [...out]
}

export type OrderSearchQuery =
  | { kind: 'none' }
  | { kind: 'text'; text: string; digits: string | null }

/** `q` → what to search: order number / name text, plus phone digits when there are 4+. */
export function parseOrderSearch(raw: unknown): OrderSearchQuery {
  const text = String(raw ?? '').trim().replace(/^#/, '').slice(0, 60)
  if (text.length < 2) return { kind: 'none' }
  const digits = text.replace(/\D/g, '')
  return { kind: 'text', text, digits: digits.length >= 4 ? digits : null }
}

export type AttachMatch = 'phone' | 'name' | 'recent' | 'search'

export interface AttachCandidateInput {
  id: string
  orderId: string
  timestamp: Date
  phone: string | null
  customerName: string
}

/**
 * Why an order is offered for this chat. Same phone first, then same name, then the rest
 * (recent orders with no chat, or search hits). Newest first inside each group.
 */
export function rankAttachCandidates<T extends AttachCandidateInput>(
  orders: T[],
  ctx: { tails: string[]; names: string[]; searching: boolean; query?: string; recentIds?: Set<string> },
): Array<T & { match: AttachMatch }> {
  const names = ctx.names.map(normName).filter((n) => n.length >= 3)
  const weight: Record<AttachMatch, number> = { phone: 0, name: 1, search: 2, recent: 3 }
  const q = (ctx.query || '').trim().toLowerCase()
  // Exact order number first when searching ("1791" → #1791 before #17910).
  const exact = (o: T) => {
    const id = o.orderId.toLowerCase()
    return q && (id === q || id.endsWith(`-${q}`)) ? 0 : 1
  }
  return orders
    .map((o) => {
      const tail = phoneTail(o.phone)
      const name = normName(o.customerName)
      const match: AttachMatch =
        tail && ctx.tails.includes(tail)
          ? 'phone'
          : name && names.some((n) => sameFirstName(n, name))
            ? 'name'
            : ctx.searching || (ctx.recentIds && !ctx.recentIds.has(o.id))
              ? 'search'
              : 'recent'
      return { ...o, match }
    })
    .sort(
      (a, b) =>
        exact(a) - exact(b) || weight[a.match] - weight[b.match] || b.timestamp.getTime() - a.timestamp.getTime(),
    )
}

function normName(v: string | null | undefined): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "Isidro" (WhatsApp profile) vs "Isidro Con Matarrita" (order): first name + any shared word. */
function sameFirstName(a: string, b: string): boolean {
  const wa = a.split(' ')
  const wb = b.split(' ')
  if (wa[0] !== wb[0] || wa[0].length < 3) return false
  if (wa.length === 1 || wb.length === 1) return true
  return wa.slice(1).some((w) => w.length >= 3 && wb.slice(1).includes(w))
}
