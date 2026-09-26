'use client'

import { Plus } from 'lucide-react'
import { AgentStatusChip } from './AgentChips'

export type AgentListItem = {
  id: string
  name: string
  emoji: string
  description: string | null
  status: string
}

type AgentListPanelProps = {
  agents: AgentListItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate?: () => void
  createDisabled?: boolean
  creating?: boolean
}

/** AGENT-01 · "Tus agentes" list (left column). */
export function AgentListPanel({
  agents,
  selectedId,
  onSelect,
  onCreate,
  createDisabled = false,
  creating = false,
}: AgentListPanelProps) {
  return (
    <aside
      className="flex max-h-[40dvh] flex-col rounded-2xl bg-white p-3 ring-1 ring-slate-200/70 md:max-h-none"
      aria-label="Tus agentes"
    >
      <p className="mb-2 px-2 text-[12px] font-semibold text-slate-800">
        Tus agentes{' '}
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {agents.length}
        </span>
      </p>
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {agents.map((a) => {
          const active = selectedId === a.id
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onSelect(a.id)}
                aria-current={active ? 'true' : undefined}
                className={`flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${
                  active ? 'bg-[#EEF0FF] ring-1 ring-[#5B6CFF]/20' : 'hover:bg-slate-50'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base ${
                    active ? 'bg-white shadow-sm' : 'bg-slate-100'
                  }`}
                  aria-hidden
                >
                  {a.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">
                    {a.name}
                  </span>
                  {a.description ? (
                    <span className="block truncate text-[11px] text-slate-500">
                      {a.description}
                    </span>
                  ) : null}
                  <span className="mt-1 block">
                    <AgentStatusChip status={a.status} />
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {onCreate ? (
        <button
          type="button"
          onClick={onCreate}
          disabled={createDisabled}
          className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2.5 text-[12px] font-medium text-slate-500 hover:border-[#5B6CFF]/40 hover:text-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {creating ? 'Creando…' : 'Nuevo agente'}
        </button>
      ) : null}
    </aside>
  )
}
