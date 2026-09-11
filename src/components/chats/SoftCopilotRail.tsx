'use client'

import {
  buildSuggestedReply,
  stubSources,
  type ConversationStatus,
  type SoftConversation,
  type SoftTag,
} from '@/lib/chat-soft-copilot'

type RailTab = 'detalle' | 'copilot'

interface SoftCopilotRailProps {
  conversation: SoftConversation | null
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  onAddToComposer: (draft: string) => void
  onStatusChange: (status: ConversationStatus) => void
  onToggleTag: (tag: SoftTag) => void
  askValue: string
  onAskChange: (value: string) => void
}

const ALL_TAGS: SoftTag[] = ['Envío', 'VIP', 'Nuevo']
const STATUSES: Array<{ id: ConversationStatus; label: string }> = [
  { id: 'nuevo', label: 'Nuevo' },
  { id: 'en_curso', label: 'En curso' },
  { id: 'hecho', label: 'Hecho' },
]

function statusLabel(status: ConversationStatus) {
  if (status === 'nuevo') return 'Nuevo'
  if (status === 'hecho') return 'Hecho'
  return 'En curso'
}

export function SoftCopilotRail({
  conversation,
  tab,
  onTabChange,
  onAddToComposer,
  onStatusChange,
  onToggleTag,
  askValue,
  onAskChange,
}: SoftCopilotRailProps) {
  const suggestion = conversation
    ? buildSuggestedReply(conversation)
    : { title: 'Sugerencia', draft: 'Seleccioná un chat para ver una sugerencia.' }
  const sources = stubSources(conversation)

  return (
    <aside className="hidden h-full w-[268px] shrink-0 flex-col overflow-hidden border-l border-slate-100 bg-[#fafbfd] xl:flex">
      <div className="p-3">
        <div className="flex rounded-[10px] bg-white p-1 shadow-sm ring-1 ring-slate-100">
          <button
            type="button"
            onClick={() => onTabChange('detalle')}
            className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
              tab === 'detalle'
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : 'text-slate-400'
            }`}
          >
            Detalle
          </button>
          <button
            type="button"
            onClick={() => onTabChange('copilot')}
            className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
              tab === 'copilot'
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : 'text-slate-400'
            }`}
          >
            Copilot
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {tab === 'copilot' ? (
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-medium text-slate-400">Sugerencia</p>
              <div className="mt-2 rounded-[14px] bg-white p-3 shadow-sm ring-1 ring-slate-100">
                <p className="text-xs font-semibold text-slate-900">{suggestion.title}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  “{suggestion.draft}”
                </p>
                <button
                  type="button"
                  disabled={!conversation}
                  onClick={() => onAddToComposer(suggestion.draft)}
                  className="mt-3 w-full rounded-lg bg-[#5b6cff] py-2.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Agregar al composer
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-slate-400">Fuentes relevantes</p>
              <ul className="mt-2 space-y-1.5">
                {sources.map((src) => (
                  <li key={src.label}>
                    {src.href ? (
                      <a
                        href={src.href}
                        className="block rounded-lg bg-white px-3 py-2.5 text-xs text-indigo-700 ring-1 ring-slate-100 hover:bg-indigo-50"
                      >
                        {src.label}
                      </a>
                    ) : (
                      <span className="block rounded-lg bg-white px-3 py-2.5 text-xs text-indigo-700 ring-1 ring-slate-100">
                        {src.label}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            {conversation ? (
              <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <p className="text-[11px] font-medium text-slate-400">Contacto</p>
                <div className="mt-2 space-y-0.5 text-xs text-slate-700">
                  <p>{conversation.recipientName || conversation.recipientId}</p>
                  <p className="text-slate-500">{conversation.recipientId}</p>
                  <p>
                    {conversation.platform === 'whatsapp' ? 'WA' : 'IG'} ·{' '}
                    {conversation.accountLabel.replace(/^(WA|IG)\s·\s/, '')}
                  </p>
                  <p>Estado: {statusLabel(conversation.status)}</p>
                  <p>Etiquetas: {conversation.tags.join(', ') || '—'}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {conversation ? (
              <>
                <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                  <p className="text-[11px] font-medium text-slate-400">Contacto</p>
                  <div className="mt-2 space-y-1 text-xs text-slate-700">
                    <p className="font-medium">{conversation.recipientName}</p>
                    <p className="text-slate-500">{conversation.recipientId}</p>
                    <p>
                      Canal:{' '}
                      {conversation.platform === 'whatsapp' ? 'WhatsApp' : 'Instagram'}
                    </p>
                    <p>Cuenta: {conversation.accountLabel}</p>
                    {conversation.orderId ? (
                      <p>
                        Pedido:{' '}
                        <a className="text-indigo-700 underline" href="/ventas">
                          {conversation.orderId}
                        </a>
                      </p>
                    ) : (
                      <p className="text-slate-400">Pedido: — (stub si hay orderId)</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-medium text-slate-400">Estado</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUSES.map((s) => {
                      const active = conversation.status === s.id
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onStatusChange(s.id)}
                          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                            active
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {s.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-medium text-slate-400">Etiquetas</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ALL_TAGS.map((tag) => {
                      const active = conversation.tags.includes(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => onToggleTag(tag)}
                          className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                            active
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {tag}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            ) : (
              <div className="px-1 py-8 text-center">
                <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[#e8ecff] text-sm font-semibold text-[#5b6cff]">
                  i
                </div>
                <p className="text-xs text-slate-400">Seleccioná un chat para ver el detalle.</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 p-3">
        {conversation && tab === 'copilot' ? (
          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-medium text-slate-400">Estado rápido</p>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => {
                const active = conversation.status === s.id
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => onStatusChange(s.id)}
                    className={`rounded-lg px-2 py-1 text-[11px] font-medium transition-colors ${
                      active ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        <input
          value={askValue}
          onChange={(e) => onAskChange(e.target.value)}
          placeholder="Preguntá a Betsy… (próx.)"
          aria-label="Preguntar a Betsy (próximamente)"
          className="w-full rounded-[10px] border-0 bg-white px-3 py-2.5 text-xs text-slate-800 outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5b6cff]/30"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && askValue.trim()) {
              e.preventDefault()
              onAskChange('')
            }
          }}
        />
        <p className="mt-1.5 text-[10px] text-slate-400">
          Enter limpia el borrador · respuesta con IA aún no conectada
        </p>
      </div>
    </aside>
  )
}
