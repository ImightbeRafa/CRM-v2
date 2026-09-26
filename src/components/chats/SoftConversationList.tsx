'use client'

import { useState } from 'react'
import { Clock, Search, Sparkles, X } from 'lucide-react'
import {
  formatRelativeEs,
  initialsFromName,
  type ChannelFilter,
  type InboxBucket,
  type SoftConversation,
  type SoftSocialAccount,
} from '@/lib/chat-soft-copilot'
import type { LineCounts } from '@/lib/chat-line-filter'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { AuroraLineFilter } from '@/components/chats/AuroraLineFilter'
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
}: SoftConversationListProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const chips: Array<{ id: ChannelFilter; label: string; activeClass: string; idleClass: string }> = [
    {
      id: 'todos',
      label: 'Todos',
      activeClass: 'bg-[#EEF0FF] text-[#4A46E5] ring-1 ring-[#5B6CFF]/25',
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
          ? 'w-full bg-[#F5F4F0]'
          : 'w-full border-r border-slate-200/70 bg-white md:w-[300px] lg:w-[320px]'
      } shrink-0`}
    >
      {compact ? (
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          <h2 className="text-[28px] font-bold leading-tight tracking-tight text-slate-900">Chats</h2>
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
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">{`Abiertos · ${openCount}`}</h2>
            {syncAgeSeconds != null ? (
              <p className="mt-0.5 text-[10px] text-slate-400">Sincronizado hace {syncAgeSeconds}s</p>
            ) : null}
          </div>
          <span className="text-[11px] text-slate-500">Más nuevos</span>
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

      {compact && bucket && onBucketChange ? (
        <div
          role="tablist"
          aria-label="Bandeja"
          className="mx-4 mt-3 grid grid-cols-4 gap-0.5 rounded-2xl bg-[#EAE8E2] p-1"
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

      <div className={`mt-2 flex-wrap gap-1.5 px-4 ${compact ? 'hidden' : 'flex'}`}>
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
                <a href="/config?tab=social" className={auroraButtonPrimary}>
                  Ir a Canales
                </a>
                {!demoMode && onLoadDemo ? (
                  <button type="button" onClick={onLoadDemo} className={auroraButtonSecondary}>
                    Cargar chats DEMO (locales)
                  </button>
                ) : null}
              </>
            }
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
                const aiHandled = conv.agentStateDot === 'IA'
                return (
                  <li key={key}>
                    <button
                      type="button"
                      data-soft-conv-key={key}
                      onClick={() => onSelect(conv)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                        selected ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]' : 'active:bg-white/70'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <div
                          className={`flex h-[52px] w-[52px] items-center justify-center rounded-full text-[16px] font-bold ${
                            isDemo ? 'bg-slate-200 text-slate-600' : avatarTint(name)
                          }`}
                        >
                          {initialsFromName(conv.recipientName)}
                        </div>
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white ring-2 ring-[#F5F4F0]">
                          <ChannelLogo platform={conv.platform} size={14} />
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[16px] font-semibold text-slate-900">{name}</p>
                          <span
                            className={`shrink-0 text-[12px] ${
                              unread > 0 ? 'font-semibold text-[#5B3FE0]' : 'text-slate-400'
                            }`}
                          >
                            {formatRelativeEs(conv.lastMessageAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="min-w-0 flex-1 truncate text-[14px] text-slate-500">
                            {conv.lastMessage || '—'}
                          </p>
                          {isDemo ? (
                            <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-900">
                              Demo
                            </span>
                          ) : null}
                          {aiHandled ? (
                            <span
                              className="flex shrink-0 items-center gap-1 rounded-lg bg-[#F1EEFF] px-2 py-1 text-[12px] font-semibold text-[#5B3FE0]"
                              data-testid="soft-agent-dot"
                            >
                              <Sparkles className="h-3 w-3" aria-hidden />
                              IA
                            </span>
                          ) : conv.agentStateDot ? (
                            <span
                              className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[12px] font-semibold text-slate-600"
                              data-testid="soft-agent-dot"
                            >
                              {conv.agentStateDot}
                            </span>
                          ) : null}
                          {conv.status === 'nuevo' ? (
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
                    onClick={() => onSelect(conv)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                      selected ? 'bg-[#F1F3FF] ring-1 ring-inset ring-[#5B6CFF]/20' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarClass(conv.platform, isDemo)}`}
                    >
                      {initialsFromName(conv.recipientName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-slate-900">
                          {conversationDisplayName(conv)}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatRelativeEs(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {conv.lastMessage || '—'}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-1 truncate text-[11px] text-slate-400">
                          {isDemo ? (
                            <span className="mr-1 rounded bg-amber-100 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-900">
                              Demo
                            </span>
                          ) : null}
                          <ChannelLogo platform={conv.platform} size={12} className="shrink-0" />
                          <span className="truncate">{conv.accountLabel}</span>
                          {conv.agentEmoji || conv.agentStateDot ? (
                            <span
                              className="ml-1 shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-semibold text-slate-600"
                              data-testid="soft-agent-dot"
                            >
                              {conv.agentEmoji ? `${conv.agentEmoji} ` : ''}
                              {conv.agentStateDot || ''}
                            </span>
                          ) : null}
                        </p>
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

function conversationDisplayName(conv: SoftConversation) {
  return conv.recipientName || conv.recipientId
}
