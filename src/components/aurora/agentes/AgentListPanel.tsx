'use client'

import { FlaskConical, Plus, Settings2 } from 'lucide-react'
import { AgentStatusPill } from './AgentChips'

export type AgentListItem = {
  id: string
  name: string
  emoji: string
  description: string | null
  status: string
  /** Active line bindings from the list API, when present. */
  bindings?: Array<{ isActive: boolean; socialAccountId: string | null }>
}

type AgentListPanelProps = {
  agents: AgentListItem[]
  selectedId: string | null
  onConfigure: (id: string) => void
  onProbar: (id: string) => void
  onCreate?: () => void
  createDisabled?: boolean
  creating?: boolean
}

function lineCount(a: AgentListItem): number | null {
  if (!Array.isArray(a.bindings)) return null
  return a.bindings.filter((b) => b.isActive && b.socialAccountId).length
}

/** AGENT-01 · "Tus agentes": full-width cards with Configurar / Probar (per-agent metrics have no data source). */
export function AgentListPanel({
  agents,
  selectedId,
  onConfigure,
  onProbar,
  onCreate,
  createDisabled = false,
  creating = false,
}: AgentListPanelProps) {
  return (
    <section aria-label="Tus agentes" data-testid="agent-list">
      <p className="mb-3 text-[13px] font-semibold text-slate-800">
        Tus agentes{' '}
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {agents.length}
        </span>
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const lines = lineCount(a)
          return (
            <li
              key={a.id}
              className={`flex flex-col rounded-2xl border bg-white p-4 ${
                selectedId === a.id ? 'border-[#5B6CFF]/40' : 'border-slate-200/70'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-xl"
                  aria-hidden
                >
                  {a.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-[#0E0D17]">{a.name}</span>
                    <AgentStatusPill status={a.status} />
                  </div>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">
                    {a.description || 'Sin descripción'}
                  </p>
                  {lines !== null ? (
                    <p className="mt-1 text-[12px] text-slate-400">
                      {lines === 0 ? 'No atiende a ninguna línea' : `${lines} ${lines === 1 ? 'línea' : 'líneas'}`}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => onConfigure(a.id)}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#5B6CFF] px-3 text-[13px] font-medium text-white hover:bg-[#4A5AE8]"
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  Configurar
                </button>
                <button
                  type="button"
                  onClick={() => onProbar(a.id)}
                  className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-medium text-[#0E0D17] hover:bg-slate-50"
                >
                  <FlaskConical className="h-3.5 w-3.5" aria-hidden />
                  Probar
                </button>
              </div>
            </li>
          )
        })}
        {onCreate ? (
          <li>
            <button
              type="button"
              onClick={onCreate}
              disabled={createDisabled}
              className="flex h-full min-h-[132px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-6 text-[13px] font-medium text-slate-500 hover:border-[#5B6CFF]/40 hover:text-[#5B6CFF] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {creating ? 'Creando…' : 'Crear agente'}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
