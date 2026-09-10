'use client'

import {
  formatRelativeEs,
  initialsFromName,
  platformShort,
  type ChannelFilter,
  type SoftConversation,
  type SoftSocialAccount,
  accountDisplayLabel,
} from '@/lib/chat-soft-copilot'

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
}

function conversationKey(c: SoftConversation) {
  return `${c.socialAccountId}::${c.recipientId}`
}

function avatarClass(platform: string) {
  return platform === 'instagram' ? 'bg-pink-500' : 'bg-green-500'
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
}: SoftConversationListProps) {
  const chips: Array<{ id: ChannelFilter; label: string; activeClass: string; idleClass: string }> = [
    {
      id: 'whatsapp',
      label: 'WA',
      activeClass: 'bg-green-100 text-green-800 ring-1 ring-green-200',
      idleClass: 'bg-green-50/80 text-green-800',
    },
    {
      id: 'instagram',
      label: 'IG',
      activeClass: 'bg-pink-100 text-pink-800 ring-1 ring-pink-200',
      idleClass: 'bg-pink-50/80 text-pink-800',
    },
    {
      id: 'todos',
      label: 'Todos',
      activeClass: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
      idleClass: 'bg-slate-50 text-slate-600',
    },
  ]

  return (
    <section
      className={`flex h-full min-h-0 flex-col border-r border-slate-100 bg-white ${
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
              Actualizando… hace {syncAgeSeconds}s
            </p>
          ) : null}
        </div>
        {compact ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">⌘K</span>
        ) : (
          <span className="text-[11px] text-slate-500">Más nuevos</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 px-4">
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

      <div className="mt-2 px-4">
        <label className="block">
          <span className="sr-only">Filtrar por cuenta</span>
          <select
            value={selectedAccountId}
            onChange={(e) =>
              onAccountFilter(e.target.value === 'all' ? 'all' : e.target.value)
            }
            className="w-full appearance-none rounded-lg border-0 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 outline-none ring-1 ring-slate-100 focus:ring-2 focus:ring-[#5b6cff]/30"
          >
            <option value="all">Cuenta: Todas</option>
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {accountDisplayLabel(acc)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Cargando…</p>
        ) : emptyReason === 'no-channels' ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">No hay canales conectados</p>
            <p className="mt-1 text-xs text-slate-500">
              Conectá WhatsApp o Instagram en Cuentas para ver chats de clientes.
            </p>
            <a
              href="/config/social"
              className="mt-3 inline-block text-sm font-medium text-[#5b6cff] hover:underline"
            >
              Ir a Cuentas →
            </a>
          </div>
        ) : emptyReason === 'no-results' ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Sin resultados</p>
            <p className="mt-1 text-xs text-slate-500">Probá otra búsqueda o quitá filtros.</p>
          </div>
        ) : emptyReason === 'no-chats' ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-slate-700">Todavía no hay chats</p>
            <p className="mt-1 text-xs text-slate-500">
              Cuando un cliente escriba por WA o IG, aparece acá.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {conversations.map((conv) => {
              const key = conversationKey(conv)
              const selected = selectedKey === key
              const unread = conv.unreadCount || 0
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => onSelect(conv)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors ${
                      selected ? 'bg-[#f8faff]' : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarClass(conv.platform)}`}
                    >
                      {initialsFromName(conv.recipientName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-[13px] font-semibold text-slate-900">
                          {conv.recipientName || conv.recipientId}
                        </p>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {formatRelativeEs(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {conv.lastMessage || '—'}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="truncate text-[11px] text-slate-400">
                          {platformShort(conv.platform)} ·{' '}
                          {conv.accountLabel.replace(/^(WA|IG)\s·\s/, '')}
                        </p>
                        {unread > 0 ? (
                          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#5b6cff] px-1 text-[10px] font-bold text-white">
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
      </div>
    </section>
  )
}
