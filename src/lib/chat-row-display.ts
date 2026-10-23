/**
 * /chats display helpers (Rafael 2026-10-22): which business line + channel a chat belongs to, the linked order in a
 * readable way (short number, status, total) and UI chrome without emojis. Pure; used by list, thread and details.
 */
import { formatColones } from '@/lib/chat-catalog'

export function channelName(platform: string | null | undefined): string {
  return platform === 'instagram' ? 'Instagram' : platform === 'whatsapp' ? 'WhatsApp' : 'Chat'
}

/** "Sleeping Patches · WhatsApp" / "@forge.costarica · Instagram". */
export function lineChannelLabel(accountLabel: string | null | undefined, platform: string | null | undefined): string {
  const line = withoutEmoji(accountLabel || '').trim()
  return line ? `${line} · ${channelName(platform)}` : channelName(platform)
}

/**
 * "#…18163" for long generated numbers ("ORDER-1792438318163"), the number itself when it is already short
 * ("1042" → "#1042"). The full number goes in the title.
 */
export function shortOrderNumber(orderNumber: string | null | undefined): string {
  const raw = String(orderNumber || '').trim().replace(/^#/, '')
  if (!raw) return ''
  const digits = /^(?:ORDER|ORD|PED)[-_]?(\d+)$/i.exec(raw)?.[1]
  if (digits) return digits.length > 6 ? `#…${digits.slice(-5)}` : `#${digits}`
  return raw.length > 10 ? `#…${raw.slice(-6)}` : `#${raw}`
}

export type OrderTone = 'open' | 'shipped' | 'done' | 'cancelled'

/** Status → chip tone (mixed-case statuses across tenants). */
export function orderStatusTone(status: string | null | undefined): OrderTone {
  const s = String(status || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  if (/^(cancelad|cancel|anulad|rechazad|devuelt)/.test(s)) return 'cancelled'
  if (/^(entregad|delivered|completad|retirad)/.test(s)) return 'done'
  if (/^(enviad|shipped|en camino|en ruta)/.test(s)) return 'shipped'
  return 'open'
}

export const ORDER_TONE_CLASS: Record<OrderTone, string> = {
  open: 'bg-amber-50 text-amber-800 ring-amber-200',
  shipped: 'bg-violet-50 text-violet-800 ring-violet-200',
  done: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
}

export function orderTotalLabel(total: number | null | undefined): string | null {
  return typeof total === 'number' && Number.isFinite(total) && total > 0 ? formatColones(total) : null
}

/** Pictographs / dingbats out of chrome text (agent labels, line names); words and accents stay. */
export function withoutEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** "Agente: 🌙 Luna · Responder" → "Luna" (the agent's own name for chrome sentences). */
export function agentDisplayName(label: string | null | undefined): string {
  const clean = withoutEmoji(String(label || ''))
    .replace(/^Agente:\s*/i, '')
    .replace(/\s*·.*$/, '')
    .trim()
  return clean || 'Agente'
}
