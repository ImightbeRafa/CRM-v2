'use client'

import {
  agentModeLabel,
  type SoftAiAgentMode,
  type SoftAiToolLogEntry,
} from '@/lib/soft-ai'
import type { ConversationStatus, SoftConversation, SoftTag } from '@/lib/chat-soft-copilot'

type RailTab = 'detalle' | 'copilot'

interface SoftCopilotRailProps {
  conversation: SoftConversation | null
  tab: RailTab
  onTabChange: (tab: RailTab) => void
  onStatusChange: (status: ConversationStatus) => void
  onToggleTag: (tag: SoftTag) => void
  agentMode: SoftAiAgentMode
  toolLog: SoftAiToolLogEntry[]
  onTakeOver: () => void
  onPauseAi: () => void
  onResumeAi: () => void
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

function toolLabel(tool: SoftAiToolLogEntry['tool']): string {
  if (tool === 'create_or_link_order') return 'Crear/vincular pedido'
  if (tool === 'get_order_status') return 'Estado pedido'
  if (tool === 'correos_guia') return 'Guía Correos'
  if (tool === 'tag_chat') return 'Etiqueta'
  if (tool === 'escalate_to_human') return 'Escalar a humano'
  const _exhaustive: never = tool
  return _exhaustive
}

export function SoftCopilotRail({
  conversation,
  tab,
  onTabChange,
  onStatusChange,
  onToggleTag,
  agentMode,
  toolLog,
  onTakeOver,
  onPauseAi,
  onResumeAi,
}: SoftCopilotRailProps) {
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
            Agente
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {tab === 'copilot' ? (
          <div className="space-y-4">
            <div className="rounded-[14px] bg-white p-3 shadow-sm ring-1 ring-slate-100">
              <p className="text-[11px] font-medium text-slate-400">Estado agente</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {agentModeLabel(agentMode)}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                La IA responde sola. Vos monitoreás, pausás o tomás el control.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={!conversation || agentMode === 'human'}
                  onClick={onTakeOver}
                  className="w-full rounded-lg bg-[#5b6cff] py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Tomar control
                </button>
                <button
                  type="button"
                  disabled={!conversation || agentMode === 'paused'}
                  onClick={onPauseAi}
                  className="w-full rounded-lg bg-slate-100 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  Pausar IA
                </button>
                <button
                  type="button"
                  disabled={!conversation || agentMode === 'ai_active'}
                  onClick={onResumeAi}
                  className="w-full rounded-lg bg-emerald-50 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                >
                  Reanudar IA
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-slate-400">Log de herramientas</p>
              {toolLog.length === 0 ? (
                <p className="mt-2 rounded-lg bg-white px-3 py-3 text-xs text-slate-400 ring-1 ring-slate-100">
                  Sin acciones aún. La IA registra tools acá.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {[...toolLog].reverse().slice(0, 12).map((entry) => (
                    <li
                      key={entry.id}
                      className="rounded-lg bg-white px-3 py-2 text-[11px] ring-1 ring-slate-100"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{toolLabel(entry.tool)}</span>
                        <span
                          className={
                            entry.ok ? 'text-emerald-600' : 'text-amber-700'
                          }
                        >
                          {entry.ok ? 'ok' : 'stub'}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-slate-500">
                        {JSON.stringify(entry.result).slice(0, 90)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
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
                  {conversation.orderId ? (
                    <p className="text-indigo-700">Pedido: {conversation.orderId}</p>
                  ) : null}
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
                      <p className="text-slate-400">Pedido: —</p>
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
    </aside>
  )
}
