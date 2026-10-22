'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Clock, Search, Sparkles, X } from 'lucide-react'
import {
  formatRelativeEs,
  initialsFromName,
  type ChannelFilter,
  type InboxBucket,
  type SoftAiMonitorStats,
  type SoftConversation,
  type SoftTag,
  type SoftSocialAccount,
} from '@/lib/chat-soft-copilot'
import type { LineCounts } from '@/lib/chat-line-filter'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { AuroraLineFilter } from '@/components/chats/AuroraLineFilter'
import { chatPreviewText } from '@/lib/chat-message-display'
import { AuroraAvatar } from '@/components/aurora/shell/AuroraAvatar'
import { PeerAvatar } from '@/components/chats/PeerAvatar'
import { conversationDisplayName } from '@/lib/chat-peer-display'
import { AuroraTopActions } from '@/components/aurora/shell/AuroraTopActions'
import { ChatTagFilter, ChatViewMenu } from '@/components/chats/ChatViewMenu'
import { SyncAgeLabel } from '@/components/chats/SyncAgeLabel'
import { SoundToggle } from '@/components/chats/SoundToggle'
import { InboxViewTabs } from '@/components/chats/InboxViewTabs'
import { waitTone, type InboxView, type InboxViewCounts } from '@/lib/chat-inbox-views'
import {
  AuroraEmptyState,
  AuroraErrorState,
  AuroraListSkeleton,
  auroraButtonPrimary,
  auroraButtonSecondary,
} from '@/components/aurora/states'

interface SoftConversationListProps {
  conversations: SoftConversation[]
  selectedKey: string | null
  onSelect: (conversation: SoftConversation) => void
  channelFilter: ChannelFilter
  onChannelFilter: (filter: ChannelFilter) => void
  accounts: SoftSocialAccount[]
  selectedAccountId: string | 'all'
  onAccountFilter: (id: string | 'all') => void
  openCount: number
  syncAgeSeconds: number | null
  /** When set, the list shows a self-ticking age label instead of `syncAgeSeconds`. */
  lastSyncAt?: number | null
  loading: boolean
  emptyReason: 'no-channels' | 'no-chats' | 'no-results' | null
  compact?: boolean
  demoMode?: boolean
  onLoadDemo?: () => void
  onRemoveDemo?: () => void
  hasDemoInList?: boolean
  hasMoreConversations?: boolean
  loadingMoreConversations?: boolean
  onLoadMoreConversations?: () => void
  /** Per-line open counts for the line dropdown (Aurora). */
  countsByAccount?: Map<string, LineCounts>
  totalOpen?: number
  /** First page failed to load — show STATE-01 error with retry. */
  loadError?: boolean
  onRetryLoad?: () => void
  /** Mobile (compact) bandeja tabs + search — CHAT-M01. */
  bucket?: InboxBucket
  onBucketChange?: (bucket: InboxBucket) => void
  search?: string
  onSearchChange?: (value: string) => void
  /** Desktop header: agent summary in the views menu + tag filter button. */
  monitor?: SoftAiMonitorStats
  tags?: SoftTag[]
  activeTag?: SoftTag | null
  onTagClick?: (tag: SoftTag) => void
  /**
   * Quick views (Persona / Revisar pago / Pedido por confirmar / IA atendiendo / Seguimientos) with counts —
   * desktop and mobile. They replace the agents2-notify review chips (same tags, now with a tab each).
   */
  inboxView?: InboxView
  inboxViewCounts?: InboxViewCounts | null
  onInboxViewChange?: (view: InboxView) => void
}

/** CHAT-M01 segmented tabs → existing inbox buckets (no new staffing model). */
const MOBILE_TABS: Array<{ id: InboxBucket; label: string }> = [
  { id: 'abiertos', label: 'Todos' },
  { id: 'tus_chats', label: 'Míos' },
  { id: 'sin_asignar', label: 'Sin asignar' },
  { id: 'ia_manejando', label: 'IA' },
]

const AVATAR_TINTS = [
  'bg-blue-100 text-blue-700',
  'bg-pink-100 text-pink-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
]

function avatarTint(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}

const FOLLOW_UP_TITLE = 'Seguimiento automático: no sube el chat en la Bandeja (míralo en Seguimientos)'

const WAIT_TONE_CLASS = {
  fresh: 'bg-slate-100 text-slate-600 ring-slate-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-300',
  late: 'bg-red-50 text-red-700 ring-red-300',
} as const

/** "Sin responder": how long the customer has waited; amber after 1 h, red after 4 h. */
function WaitBadge({ since, small = false }: { since?: string | null; small?: boolean }) {
  if (!since) return null
  const tone = waitTone(since)
  return (
    <span
      className={`flex shrink-0 items-center gap-1 rounded-lg font-semibold ring-1 ${WAIT_TONE_CLASS[tone]} ${
        small ? 'px-1.5 py-px text-[10px]' : 'px-2 py-1 text-[12px]'
      }`}
      title="Tiempo desde el último mensaje del cliente"
      data-testid="conv-wait-badge"
      data-tone={tone}
    >
      <Clock className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />
      {waitLabel(since)}
    </span>
  )
}

/** The agent left this chat to a person (safe line / hand-off / provider failure): never shown as "IA". */
function NeedsPersonChip({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-lg bg-amber-100 font-semibold text-amber-900 ring-1 ring-amber-300 ${
        small ? 'ml-1 px-1 py-px text-[9px]' : 'px-2 py-1 text-[12px]'
      }`}
      title="El agente le pasó este chat a una persona: nadie le ha respondido todavía"
      data-testid="conv-needs-person"
    >
      Necesita persona
    </span>
  )
}

/** Top of "Sin responder": how many wait, how many for long, and the oldest wait. */
/** "espera 2h" / "espera desde ayer" / "espera desde 12 oct". */
function waitLabel(since: string): string {
  const rel = formatRelativeEs(since)
  return /^\d+[smhd]$/.test(rel) ? `espera ${rel}` : `espera desde ${rel.toLowerCase()}`
}

function UnansweredSummary({ conversations, total }: { conversations: SoftConversation[]; total?: number }) {
  const since = conversations.map((c) => c.waitingSince).filter((s): s is string => Boolean(s))
  const oldest = since.length ? since.reduce((a, b) => (a < b ? a : b)) : null
  const late = since.filter((s) => waitTone(s) === 'late').length
  return (
    <p className="mx-4 mt-2 text-[12px] text-slate-600" data-testid="unanswered-summary">
      <span className="font-semibold text-slate-900">{conversations.length}</span>{' '}
      {conversations.length === 1 ? 'cliente espera' : 'clientes esperan'} respuesta
      {late ? <span className="font-semibold text-red-700"> · {late} hace más de 4 h</span> : null}
      {oldest ? <> · el que más: {waitLabel(oldest)}</> : null}
      {typeof total === 'number' && total > conversations.length ? (
        <span className="text-slate-500"> · mostrando los {conversations.length} más recientes de {total}</span>
      ) : null}
    </p>
  )
}

function conversationKey(c: SoftConversation) {
  return `${c.socialAccountId}::${c.recipientId}`
}

function avatarClass(platform: string, isDemo?: boolean) {
  if (isDemo) return 'bg-slate-400'
  return platform === 'instagram' ? 'bg-pink-500' : 'bg-emerald-500'
}

export function SoftConversationList({
  conversations,
  selectedKey,
  onSelect,
  channelFilter,
  onChannelFilter,
  accounts,
  selectedAccountId,
  onAccountFilter,
  openCount,
  syncAgeSeconds,
  lastSyncAt,
  loading,
  emptyReason,
  compact,
  demoMode,
  onLoadDemo,
  onRemoveDemo,
  hasDemoInList,
  hasMoreConversations,
  loadingMoreConversations,
  onLoadMoreConversations,
  countsByAccount,
  totalOpen,
  loadError,
  onRetryLoad,
  bucket,
  onBucketChange,
  search,
  onSearchChange,
  monitor,
  tags,
  activeTag,
  onTagClick,
  inboxView,
  inboxViewCounts,
  onInboxViewChange,
}: SoftConversationListProps) {
  // ⌘K on Mac, Ctrl K elsewhere (set after mount so SSR and client markup match).
  const [shortcutHint, setShortcutHint] = useState('Ctrl K')
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setShortcutHint('⌘K')
  }, [])
  const [searchOpen, setSearchOpen] = useState(false)
  const chips: Array<{ id: ChannelFilter; label: string; activeClass: string; idleClass: string }> = [
    {
      id: 'todos',
      label: 'Todos',
      activeClass: 'bg-au-tint-eef0ff text-au-ink-4a46e5 ring-1 ring-[#5B6CFF]/25',
      idleClass: 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      activeClass: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
      idleClass: 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    },
    {
      id: 'instagram',
      label: 'Instagram',
      activeClass: 'bg-pink-50 text-pink-800 ring-1 ring-pink-200',
      idleClass: 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    },
  ]

  return (
    <section
      className={`flex h-full min-h-0 flex-col ${
        compact
          ? 'w-full bg-au-tint-f5f4f0'
          : 'w-full border-r border-slate-200/70 bg-white md:w-[300px] lg:w-[320px]'
      } shrink-0`}
    >
      {compact ? (
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">Chats</h2>
          <div className="flex shrink-0 items-center gap-2">
            {lastSyncAt !== undefined ? <SoundToggle size="lg" /> : null}
            {onSearchChange ? (
              <button
                type="button"
                aria-label={searchOpen ? 'Cerrar búsqueda' : 'Buscar chats'}
                aria-pressed={searchOpen}
                onClick={() => {
                  if (searchOpen) onSearchChange('')
                  setSearchOpen((v) => !v)
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200/70"
              >
                {searchOpen ? <X className="h-5 w-5" aria-hidden /> : <Search className="h-5 w-5" aria-hidden />}
              </button>
            ) : null}
            <AuroraTopActions />
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {bucket && onBucketChange ? (
                <ChatViewMenu bucket={bucket} onBucketChange={onBucketChange} count={conversations.length} monitor={monitor} />
              ) : (
                <h2 className="text-[15px] font-semibold text-slate-900">{`Abiertos · ${openCount}`}</h2>
              )}
              {lastSyncAt !== undefined ? (
                <SyncAgeLabel lastSyncAt={lastSyncAt} />
              ) : syncAgeSeconds != null ? (
                <p className="mt-0.5 text-[10px] text-slate-400">Sincronizado hace {syncAgeSeconds}s</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {lastSyncAt !== undefined ? <SoundToggle /> : null}
              <span className="pt-1 text-[11px] text-slate-500">Más nuevos</span>
            </div>
          </div>
          {onSearchChange ? (
            <label className="relative mt-3 block">
              <span className="sr-only">Buscar chats</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search ?? ''}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar chats…"
                data-chat-search
                aria-keyshortcuts="Control+K Meta+K"
                className="w-full rounded-xl border-0 bg-slate-50 py-2 pl-8 pr-14 text-[12.5px] text-slate-800 outline-none ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#5B6CFF]/40"
              />
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400 ring-1 ring-slate-200">
                {shortcutHint}
              </kbd>
            </label>
          ) : null}
        </div>
      )}

      {compact && searchOpen && onSearchChange ? (
        <div className="px-4 pt-3">
          <input
            autoFocus
            type="search"
            value={search ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar chats"
            data-chat-search
            aria-label="Buscar chats"
            className="w-full rounded-2xl border-0 bg-white px-4 py-2.5 text-[16px] text-slate-800 outline-none ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5B6CFF]/40"
          />
        </div>
      ) : null}

      {hasDemoInList ? (
        <div className="mx-4 mt-3 flex items-start justify-between gap-2 rounded-[10px] bg-amber-50 px-3 py-2 ring-1 ring-amber-100">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-amber-900">Chats DEMO</p>
            <p className="text-[10px] leading-snug text-amber-800/90">
              Solo local · no son clientes reales · se pueden quitar
            </p>
          </div>
          {onRemoveDemo ? (
            <button
              type="button"
              onClick={onRemoveDemo}
              className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
            >
              Quitar demo
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 px-4">
        <AuroraLineFilter
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          onSelect={onAccountFilter}
          totalOpen={totalOpen ?? openCount}
          countsByAccount={countsByAccount ?? new Map()}
          variant={compact ? 'card' : 'pill'}
        />
      </div>

      {inboxView && onInboxViewChange ? (
        <InboxViewTabs view={inboxView} counts={inboxViewCounts ?? null} onChange={onInboxViewChange} wrap={!compact} />
      ) : null}
      {inboxView === 'sin_responder' && conversations.length ? (
        <UnansweredSummary conversations={conversations} total={inboxViewCounts?.sin_responder} />
      ) : null}

      {compact && bucket && onBucketChange ? (
        <div
          role="tablist"
          aria-label="Bandeja"
          className="mx-4 mt-3 grid grid-cols-4 gap-0.5 rounded-2xl bg-au-tint-eae8e2 p-1"
        >
          {MOBILE_TABS.map((tab) => {
            const active = bucket === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onBucketChange(tab.id)}
                className={`truncate rounded-xl px-1 py-2 text-[13px] font-semibold transition-colors ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={`mt-2 flex-wrap items-center gap-1.5 px-4 ${compact ? 'hidden' : 'flex'}`}>
        {chips.map((chip) => {
          const active = channelFilter === chip.id
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => onChannelFilter(chip.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active ? chip.activeClass : chip.idleClass
              }`}
            >
              {chip.label}
            </button>
          )
        })}
        {tags && tags.length && onTagClick ? (
          <span className="ml-auto">
            <ChatTagFilter tags={tags} activeTag={activeTag ?? null} onTagClick={onTagClick} />
          </span>
        ) : null}
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${compact ? 'mt-3 px-2' : 'mt-3'}`}>
        {loading && conversations.length === 0 ? (
          <AuroraListSkeleton />
        ) : loadError && conversations.length === 0 ? (
          <AuroraErrorState
            title="No pudimos cargar los chats"
            description="Revisá tu conexión. Tus conversaciones están a salvo; no se perdió nada."
            onRetry={onRetryLoad}
          />
        ) : emptyReason === 'no-channels' ? (
          <AuroraEmptyState
            tone="neutral"
            icon="∅"
            title="No hay canales conectados"
            description="Conectá WhatsApp o Instagram para ver acá los chats de tus clientes."
            actions={
              <>
                <Link href="/config?tab=social" className={auroraButtonPrimary}>
                  Ir a Canales
                </Link>
                {!demoMode && onLoadDemo ? (
                  <button type="button" onClick={onLoadDemo} className={auroraButtonSecondary}>
                    Cargar chats DEMO (locales)
                  </button>
                ) : null}
              </>
            }
          />
        ) : emptyReason === 'no-results' && inboxView === 'sin_responder' && inboxViewCounts?.sin_responder === 0 && !search?.trim() ? (
          // All clear only when the server count agrees (never while the view is loading or failed).
          <AuroraEmptyState
            tone="neutral"
            icon="✓"
            title="Nadie espera respuesta"
            description="Todos los clientes ya tienen respuesta."
          />
        ) : emptyReason === 'no-results' ? (
          <AuroraEmptyState
            tone="neutral"
            icon="⌕"
            title="Sin resultados"
            description="Probá otra búsqueda, quitá etiquetas o cambiá de bandeja o de línea."
          />
        ) : emptyReason === 'no-chats' ? (
          <AuroraEmptyState
            icon="✓"
            title="Todo al día"
            description="No hay conversaciones abiertas. Cuando un cliente escriba por WhatsApp o Instagram, aparece acá."
            actions={
              <>
                {selectedAccountId !== 'all' ? (
                  <button
                    type="button"
                    onClick={() => onAccountFilter('all')}
                    className={auroraButtonPrimary}
                  >
                    Ver todas las líneas
                  </button>
                ) : null}
                {!demoMode && onLoadDemo ? (
                  <button type="button" onClick={onLoadDemo} className={auroraButtonSecondary}>
                    Cargar chats DEMO
                  </button>
                ) : null}
              </>
            }
          />
        ) : (
          <ul className={compact ? 'space-y-1 pb-3' : 'divide-y divide-slate-50'}>
            {conversations.map((conv) => {
              const key = conversationKey(conv)
              const selected = selectedKey === key
              const unread = conv.unreadCount || 0
              const isDemo = Boolean(conv.isDemo)
              if (compact) {
                const name = conversationDisplayName(conv)
                // Agentes IA 2.0: "IA" only when the line answers this chat; otherwise who has it ("Con Ana", "Sin IA").
                const aiHandled = conv.aiStatus ? conv.aiStatus.state === 'ia' : conv.agentStateDot === 'IA'
                const aiChip = conv.aiStatus ? conv.aiStatus.label : conv.agentStateDot
                return (
                  <li key={key}>
                    <button
                      type="button"
                      data-soft-conv-key={key}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => onSelect(conv)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                        selected ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]' : 'active:bg-white/70'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <PeerAvatar
                          src={isDemo ? null : conv.recipientAvatarUrl}
                          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full text-[16px] font-bold ${
                            isDemo ? 'bg-slate-200 text-slate-600' : avatarTint(name)
                          }`}
                        >
                          {initialsFromName(conv.recipientName)}
                        </PeerAvatar>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-2 ring-au-line-f5f4f0">
                          <ChannelLogo platform={conv.platform} size={14} />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[16px] font-semibold text-slate-900">{name}</p>
                          <span
                            className={`shrink-0 text-[12px] ${
                              unread > 0 ? 'font-semibold text-au-ink-5b3fe0' : 'text-slate-500'
                            }`}
                          >
                            {formatRelativeEs(conv.lastMessageAt)}
                          </span>
                        </div>
                        {/* Sin responder: the waiting message gets its own line; the chips wrap under it. */}
                        <div className={`mt-1 flex items-center gap-2 ${inboxView === 'sin_responder' ? 'flex-wrap' : ''}`}>
                          <p
                            className={`min-w-0 flex-1 truncate text-[14px] text-slate-500 ${inboxView === 'sin_responder' ? 'basis-full' : ''}`}
                            title={conv.lastIsFollowUp ? FOLLOW_UP_TITLE : undefined}
                          >
                            {conv.lastIsFollowUp ? '↻ ' : ''}
                            {chatPreviewText(conv.lastMessage) || '—'}
                          </p>
                          {conv.orderNumber ? (
                            <span
                              className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                              title="Pedido vinculado"
                              data-testid="conv-order-chip"
                            >
                              #{conv.orderNumber}
                            </span>
                          ) : null}
                          {isDemo ? (
                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                              Demo
                            </span>
                          ) : null}
                          {inboxView === 'sin_responder' ? <WaitBadge since={conv.waitingSince} /> : null}
                          {conv.needsPerson ? (
                            <NeedsPersonChip />
                          ) : aiHandled ? (
                            <span
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-au-tint-f1eeff px-2 py-1 text-[12px] font-semibold text-au-ink-5b3fe0"
                              data-testid="soft-agent-dot"
                            >
                              <Sparkles className="h-3 w-3" aria-hidden />
                              IA
                            </span>
                          ) : aiChip ? (
                            <span
                              className="max-w-[9rem] shrink-0 truncate rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600"
                              data-testid="soft-agent-dot"
                              title={conv.aiStatus?.reason}
                            >
                              {aiChip}
                            </span>
                          ) : null}
                          {conv.status === 'nuevo' && !conv.assignee ? (
                            <span className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[12px] font-semibold text-amber-700 ring-1 ring-amber-200">
                              <Clock className="h-3 w-3" aria-hidden />
                              Sin asignar
                            </span>
                          ) : null}
                          {unread > 0 ? (
                            <span
                              aria-label={`${unread} sin leer`}
                              className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#5B3FE0] px-1.5 text-[12px] font-bold text-white"
                            >
                              {unread > 9 ? '9+' : unread}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              }
              return (
                <li key={key}>
                  <button
                    type="button"
                    data-soft-conv-key={key}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(conv)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                      selected ? 'bg-au-tint-f1f3ff ring-1 ring-inset ring-[#5B6CFF]/20' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <PeerAvatar
                      src={isDemo ? null : conv.recipientAvatarUrl}
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarClass(conv.platform, isDemo)}`}
                    >
                      {initialsFromName(conv.recipientName)}
                    </PeerAvatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-slate-900">
                          {conversationDisplayName(conv)}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-500">
                          {formatRelativeEs(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500" title={conv.lastIsFollowUp ? FOLLOW_UP_TITLE : undefined}>
                        {conv.lastIsFollowUp ? '↻ ' : ''}
                        {chatPreviewText(conv.lastMessage) || '—'}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-slate-500">
                          {isDemo ? (
                            <span className="mr-1 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                              Demo
                            </span>
                          ) : null}
                          <ChannelLogo platform={conv.platform} size={12} className="shrink-0" />
                          <span className="truncate">{conv.accountLabel}</span>
                          {conv.assignee ? (
                            <span className="ml-1 shrink-0" title={`Responsable: ${conv.assignee.name || 'asignado'}`}>
                              <AuroraAvatar
                                name={conv.assignee.name || '?'}
                                image={conv.assignee.image}
                                className="h-4 w-4 text-[8px]"
                              />
                            </span>
                          ) : null}
                          {conv.orderNumber ? (
                            <span
                              className="ml-1 shrink-0 rounded bg-emerald-50 px-1 py-px text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200"
                              title="Pedido vinculado"
                              data-testid="conv-order-chip"
                            >
                              #{conv.orderNumber}
                            </span>
                          ) : null}
                          {conv.needsPerson ? (
                            <NeedsPersonChip small />
                          ) : conv.agentEmoji || conv.agentStateDot || conv.aiStatus ? (
                            <span
                              className="ml-1 shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-semibold text-slate-600"
                              data-testid="soft-agent-dot"
                              title={conv.aiStatus?.reason}
                            >
                              {conv.agentEmoji ? `${conv.agentEmoji} ` : ''}
                              {/* Agentes IA 2.0: "IA" only when the line answers it; else "Con Ana" / "Sin IA". */}
                              {conv.aiStatus ? conv.aiStatus.label : conv.agentStateDot || ''}
                            </span>
                          ) : null}
                        </p>
                        {inboxView === 'sin_responder' ? <WaitBadge since={conv.waitingSince} small /> : null}
                        {unread > 0 ? (
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#5B6CFF] px-1 text-[10px] font-bold text-white">
                            {unread > 9 ? '9+' : unread}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {hasMoreConversations && onLoadMoreConversations && !emptyReason ? (
          <div className="flex justify-center border-t border-slate-50 px-4 py-3">
            <button
              type="button"
              onClick={onLoadMoreConversations}
              disabled={loadingMoreConversations}
              className="rounded-lg bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-100 hover:bg-slate-100 disabled:opacity-50"
            >
              {loadingMoreConversations ? 'Cargando…' : 'Cargar más'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}

