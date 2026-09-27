/** Conocimiento tab · pure display helpers (no invented percentages: states come from real counts). */

import { KNOWLEDGE_CHECKLIST_CARDS, type KnowledgeKind } from '@/lib/soft-ai/knowledge-types'

export type KnowledgeCard = {
  id: string
  title: string
  statusLabel: string
  hint: string
  inventoryWins?: boolean
  approvedCount?: number
  draftCount?: number
}

export type CardState = 'approved' | 'draft' | 'inventory' | 'empty'

/** approved > draft > live inventory (Precios only) > empty. */
export function cardState(card: KnowledgeCard): CardState {
  if ((card.approvedCount ?? 0) > 0 || /aprobado/.test(card.statusLabel)) return 'approved'
  if ((card.draftCount ?? 0) > 0 || /borrador/.test(card.statusLabel)) return 'draft'
  if (card.id === 'precios' || card.statusLabel === 'Usar inventario en vivo') return 'inventory'
  return 'empty'
}

export const CARD_STATE_TEXT: Record<CardState, string> = {
  approved: 'Listo',
  draft: 'En borrador',
  inventory: 'En vivo',
  empty: 'Falta',
}

export const KIND_LABELS: Record<KnowledgeKind, string> = {
  brand_book: 'Brand Book',
  policy: 'Política',
  faq: 'FAQ',
  channel_overlay: 'Overlay de canal',
}

export const SOURCE_STATUS: Record<string, { label: string; tone: 'ok' | 'draft' | 'muted' }> = {
  approved: { label: 'Aprobada', tone: 'ok' },
  draft: { label: 'Borrador', tone: 'draft' },
  archived: { label: 'Archivada', tone: 'muted' },
}

export function sourceStatus(status: string): { label: string; tone: 'ok' | 'draft' | 'muted' } {
  return SOURCE_STATUS[status] ?? { label: 'Archivada', tone: 'muted' }
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Checklist card the source belongs to (name starts with the card's name hint), else the kind label. */
export function sourceTopic(name: string, kind: string): string {
  const n = fold(name)
  const card = KNOWLEDGE_CHECKLIST_CARDS.find((c) => n.startsWith(fold(c.nameHint)))
  if (card) return card.title
  return KIND_LABELS[kind as KnowledgeKind] ?? '—'
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** "ahora", "hace 4 min", "hace 3 h", "12 sep". Invalid input → "—". */
export function relativeUpdated(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return '—'
  const diffMin = Math.floor((now.getTime() - t.getTime()) / 60_000)
  if (diffMin < 1) return 'ahora'
  if (diffMin < 60) return `hace ${diffMin} min`
  if (diffMin < 60 * 24) return `hace ${Math.floor(diffMin / 60)} h`
  return `${t.getDate()} ${MONTHS[t.getMonth()]}`
}
