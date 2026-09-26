'use client'

import {
  formatRelativeEs,
  initialsFromName,
  type ChannelFilter,
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
}: SoftConversationListProps) {
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
      className={`flex h-full min-h-0 flex-col border-r border-slate-200/70 bg-white ${
        compact ? 'w-full' : 'w-full md:w-[300px] lg:w-[320px]'
      } shrink-0`}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">
            {compact ? 'Chats' : `Abiertos · ${openCount}`}
          </h2>
          {!compact && syncAgeSeconds != null ? (
            <p className="mt-0.5 text-[10px] text-slate-400">
              Sincronizado hace {syncAgeSeconds}s
            </p>
          ) : null}
        </div>
        {compact ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</span>
        ) : (
          <span className="text-[11px] text-slate-500">Más nuevos</span>
        )}
      </div>

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
        />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 px-4">
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

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
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
                <a href="/config/social" className={auroraButtonPrimary}>
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
          <ul className="divide-y divide-slate-50">
            {conversations.map((conv) => {
              const key = conversationKey(conv)
              const selected = selectedKey === key
              const unread = conv.unreadCount || 0
              const isDemo = Boolean(conv.isDemo)
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
