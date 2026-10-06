import { channelIdentity } from '@/lib/agent-channel-bind'
import { channelChip, type ChannelChip } from '@/lib/pedidos-aurora'

/**
 * Canal column = the specific line an order came from.
 * Derivation (no schema change): order -> ChatMessage.orderId -> SocialAccount.
 */
export interface OrderLine {
  socialAccountId: string
  platform: 'whatsapp' | 'instagram'
  /** Line name, else phone / @handle. */
  title: string
  /** Concrete phone / @handle when it adds info beyond `title`. */
  detail: string | null
}

export interface LineAccountLike {
  id: string
  platform: string
  displayName: string | null
  displayPhoneNumber: string | null
  providerUsername: string | null
}

export interface LineMessageLike {
  orderId: string | null
  socialAccountId: string
  sentAt: string | Date
}

function toMs(value: string | Date): number {
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/** Latest message per order wins; messages whose account is unknown are skipped. */
export function pickOrderLines(
  messages: LineMessageLike[],
  accounts: LineAccountLike[],
): Record<string, OrderLine> {
  const byAccount = new Map(accounts.map((a) => [a.id, a]))
  const latest = new Map<string, { at: number; line: OrderLine }>()
  for (const m of messages) {
    if (!m.orderId) continue
    const account = byAccount.get(m.socialAccountId)
    if (!account) continue
    const at = toMs(m.sentAt)
    const prev = latest.get(m.orderId)
    if (prev && prev.at >= at) continue
    const identity = channelIdentity({ ...account, attendedByThisAgent: false })
    latest.set(m.orderId, {
      at,
      line: {
        socialAccountId: account.id,
        platform: account.platform.toLowerCase() === 'instagram' ? 'instagram' : 'whatsapp',
        title: identity.title,
        detail: identity.detail,
      },
    })
  }
  const out: Record<string, OrderLine> = {}
  for (const [orderId, { line }] of latest) out[orderId] = line
  return out
}

export interface CanalLabel {
  label: string
  detail: string | null
  family: ChannelChip['family']
  /** True when the label comes from a real line (SocialAccount). */
  hasLine: boolean
}

/** Never returns a bare "WhatsApp" / "Instagram": either a real line, "· sin línea", or "Manual". */
export function canalLabel(
  order: { salesChannel?: string | null; funnel?: string | null },
  line?: OrderLine | null,
): CanalLabel {
  const chip = channelChip({ salesChannel: order.salesChannel, funnel: order.funnel ?? undefined })
  // A website order later attached to a chat (SINPE receipt sent by WhatsApp) stays "Web".
  if (line && chip?.family === 'web') {
    return { label: chip.label, detail: `Chat: ${line.title}`, family: 'web', hasLine: false }
  }
  if (line) {
    return { label: line.title, detail: line.detail, family: line.platform, hasLine: true }
  }
  if (!chip) return { label: 'Manual', detail: null, family: 'other', hasLine: false }
  if (chip.family === 'whatsapp') return { label: 'WhatsApp · sin línea', detail: null, family: 'whatsapp', hasLine: false }
  if (chip.family === 'instagram') return { label: 'Instagram · sin línea', detail: null, family: 'instagram', hasLine: false }
  return { label: chip.label, detail: null, family: chip.family, hasLine: false }
}

export const LINE_FILTER_ALL = 'all'
export const LINE_FILTER_MANUAL = 'manual'

/** Distinct lines present in the loaded orders (for the filter select), stable by title. */
export function distinctLines(lines: Record<string, OrderLine>): OrderLine[] {
  const seen = new Map<string, OrderLine>()
  for (const line of Object.values(lines)) if (!seen.has(line.socialAccountId)) seen.set(line.socialAccountId, line)
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title, 'es'))
}

/** `all` keeps everything; `manual` keeps orders with no line; otherwise a SocialAccount id. */
export function filterByLine<T extends { id?: string; orderId: string }>(
  rows: T[],
  lines: Record<string, OrderLine>,
  filter: string,
): T[] {
  if (filter === LINE_FILTER_ALL) return rows
  return rows.filter((row) => {
    const line = lines[row.id ?? row.orderId]
    return filter === LINE_FILTER_MANUAL ? !line : line?.socialAccountId === filter
  })
}
