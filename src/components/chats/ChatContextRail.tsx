'use client'

import type { ReactNode } from 'react'
import { agentModeLabel, type SoftAiAgentMode, type SoftAiToolLogEntry } from '@/lib/soft-ai'
import type { ConversationStatus, SoftConversation, SoftTag } from '@/lib/chat-soft-copilot'
import { stageChipClass, useCrmCatalog } from '@/components/chats/useCrmCatalog'

/**
 * Chats side panel (Phase 2a): two tabs instead of three.
 * - Cliente: the chat's stage and tags (from Config › Chats), who the client is, their lifecycle
 *   stage, orders → guía, and internal notes (all in `clientPanel`).
 * - Agente: the AI agent's state and controls, unchanged.
 * Replaces SoftCopilotRail in the V2 inbox (that file is locked and still serves Legacy).
 */
export type ContextRailTab = 'cliente' | 'agente'

/** Old remembered tabs ('detalle' / 'copilot') map onto the two new ones. */
export function normalizeRailTab(tab: string | null | undefined): ContextRailTab {
  return tab === 'agente' || tab === 'copilot' ? 'agente' : 'cliente'
}

function toolLabel(tool: SoftAiToolLogEntry['tool']): string {
  if (tool === 'create_or_link_order') return 'Crear/vincular pedido'
  if (tool === 'get_order_status') return 'Estado pedido'
  if (tool === 'correos_guia') return 'Guía Correos'
  if (tool === 'tag_chat') return 'Etiqueta'
  if (tool === 'escalate_to_human') return 'Escalar a humano'
  return String(tool)
}

export function ChatContextRail({
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
  clientPanel,
}: {
  conversation: SoftConversation
  tab: ContextRailTab
  onTabChange: (tab: ContextRailTab) => void
  onStatusChange: (status: ConversationStatus) => void
  onToggleTag: (tag: SoftTag) => void
  agentMode: SoftAiAgentMode
  toolLog: SoftAiToolLogEntry[]
  onTakeOver: () => void
  onPauseAi: () => void
  onResumeAi: () => void
  /** Client, lifecycle stage, orders → guía and notes. Absent for demo chats. */
  clientPanel?: ReactNode
}) {
  const { chatStages, activeChatStages, activeTags, tagLabel } = useCrmCatalog()
  const current = chatStages.find((s) => s.key === conversation.status)
  // A chat still sitting in an archived stage keeps showing it (read-only) until moved.
  const stageOptions = current?.archived ? [...activeChatStages, current] : activeChatStages
  const tagKeys = new Set(activeTags.map((t) => t.key))
  const extraTags = conversation.tags.filter((t) => !tagKeys.has(t))

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-white" data-testid="chat-context-rail">
      <div className="p-3">
        <div className="flex rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200/70" role="tablist">
          {(['cliente', 'agente'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`rail-tab-${t}`}
              onClick={() => onTabChange(t)}
              className={`flex-1 rounded-lg py-1.5 text-xs transition-colors ${
                tab === t ? 'bg-white font-semibold text-au-ink-4a46e5 shadow-sm' : 'text-slate-400'
              }`}
            >
              {t === 'cliente' ? 'Cliente' : 'Agente'}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {tab === 'cliente' ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] font-medium text-slate-400">Etapa del chat</p>
              <div className="flex flex-wrap gap-1.5" role="listbox" aria-label="Etapa del chat">
                {stageOptions.map((s) => {
                  const active = conversation.status === s.key
                  return (
                    <button
                      key={s.key}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={s.archived}
                      onClick={() => onStatusChange(s.key)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${stageChipClass(s.color, active)} disabled:opacity-60`}
                    >
                      {s.label}
                      {s.archived ? ' (archivada)' : ''}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-medium text-slate-400">Etiquetas</p>
              <div className="flex flex-wrap gap-1.5">
                {[...activeTags.map((t) => t.key), ...extraTags].map((key) => {
                  const active = conversation.tags.includes(key)
                  const def = activeTags.find((t) => t.key === key)
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onToggleTag(key)}
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
                        active ? stageChipClass(def?.color ?? 'amber') : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {tagLabel(key)}
                    </button>
                  )
                })}
              </div>
            </div>

            {clientPanel ?? (
              <p className="rounded-xl bg-slate-50 px-3 py-3 text-[11.5px] text-slate-500 ring-1 ring-slate-100">
                Chat de demostración: sin cliente ni notas.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/70">
              <p className="text-[11px] font-medium text-slate-400">Estado del agente</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{agentModeLabel(agentMode)}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                El agente responde solo. Vos monitoreás, pausás o tomás el control.
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={agentMode === 'human'}
                  onClick={onTakeOver}
                  className="w-full rounded-lg bg-[#5B6CFF] py-2 text-xs font-medium text-white disabled:opacity-40"
                >
                  Tomar control
                </button>
                <button
                  type="button"
                  disabled={agentMode === 'paused'}
                  onClick={onPauseAi}
                  className="w-full rounded-lg bg-slate-100 py-2 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                >
                  Pausar
                </button>
                <button
                  type="button"
                  disabled={agentMode === 'ai_active'}
                  onClick={onResumeAi}
                  className="w-full rounded-lg bg-emerald-50 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
                >
                  Reanudar IA
                </button>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium text-slate-400">Actividad del agente</p>
              {toolLog.length === 0 ? (
                <p className="mt-2 rounded-lg bg-white px-3 py-3 text-xs text-slate-400 ring-1 ring-slate-100">
                  Sin acciones aún. Las acciones del agente se registran acá.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {[...toolLog].reverse().slice(0, 12).map((entry) => (
                    <li key={entry.id} className="rounded-lg bg-white px-3 py-2 text-[11px] ring-1 ring-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{toolLabel(entry.tool)}</span>
                        <span className={entry.ok ? 'text-emerald-600' : 'text-amber-700'}>{entry.ok ? 'ok' : 'stub'}</span>
                      </div>
                      <p className="mt-0.5 truncate text-slate-500">{JSON.stringify(entry.result).slice(0, 90)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <p className="text-[11px] font-medium text-slate-400">Contacto</p>
              <div className="mt-2 space-y-0.5 text-xs text-slate-700">
                <p>{conversation.recipientName || conversation.recipientId}</p>
                <p className="text-slate-500">{conversation.recipientId}</p>
                <p>
                  {conversation.platform === 'whatsapp' ? 'WA' : 'IG'} · {conversation.accountLabel.replace(/^(WA|IG)\s·\s/, '')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
