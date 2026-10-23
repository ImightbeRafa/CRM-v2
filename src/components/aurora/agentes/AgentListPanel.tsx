'use client'

import { FlaskConical, MessagesSquare, Plus, Settings2, UserRound } from 'lucide-react'
import { AgentModeChip, AgentStatusPill } from './AgentChips'
import { AgentFace, agentTitleParts } from './AgentFace'
import type { AgentAppearance } from '@/lib/agent-appearance'

export type AgentListItem = {
  id: string
  name: string
  description: string | null
  status: string
  /** Customer-facing names; the first one is the agent's face name (e.g. "Sofi"). */
  introductionNames?: string[]
  /** Saved plate / ring / display name (Config › Agentes › Personalidad); missing = default. */
  appearance?: Partial<AgentAppearance> | null
  /** `human_only` = the team answers, no AI (shown last and muted). */
  operationMode?: string
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

const isHumanOnly = (a: AgentListItem) => a.operationMode === 'human_only'

const BTN_PRIMARY =
  'inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full bg-[#5B6CFF] px-4 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[#4A5AE8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B6CFF]/40'
const BTN_SECONDARY =
  'inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-au-ink-0e0d17 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5B6CFF]/40'

/** AGENT-01 · "Tus agentes": one card per agent with its face, name, status and Configurar / Probar. */
export function AgentListPanel({
  agents,
  selectedId,
  onConfigure,
  onProbar,
  onCreate,
  createDisabled = false,
  creating = false,
}: AgentListPanelProps) {
  // The team-only lane is a real agent (it may hold lines), but it is not an AI persona: last, muted.
  const ordered = [...agents.filter((a) => !isHumanOnly(a)), ...agents.filter(isHumanOnly)]
  return (
    <section aria-label="Tus agentes" data-testid="agent-list">
      <p className="mb-4 text-[13px] font-semibold text-slate-800">
        Tus agentes{' '}
        <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {agents.length}
        </span>
      </p>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((a) => {
          const lines = lineCount(a)
          const human = isHumanOnly(a)
          const { persona, internal } = agentTitleParts(a)
          const selected = selectedId === a.id
          return (
            <li
              key={a.id}
              data-testid="agent-card"
              className={`group flex flex-col rounded-[20px] border p-5 transition-shadow ${
                human ? 'border-dashed border-slate-200 bg-slate-50/60' : 'bg-white hover:shadow-md'
              } ${selected ? 'border-[#5B6CFF]/40' : human ? '' : 'border-slate-200/70'}`}
            >
              <div className="flex items-start gap-3.5">
                {human ? (
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[30%] bg-slate-100 text-slate-500"
                    aria-hidden
                  >
                    <UserRound className="h-5 w-5" />
                  </span>
                ) : (
                  <AgentFace agent={a} size={48} animated={false} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-[15px] leading-snug text-au-ink-0e0d17">
                      {persona ? (
                        <>
                          <span className="font-semibold">{persona}</span>
                          <span className="text-slate-400"> · </span>
                          <span className="font-medium text-slate-600">{internal}</span>
                        </>
                      ) : (
                        <span className="font-semibold">{internal}</span>
                      )}
                    </p>
                    <span className="shrink-0">
                      {human ? <AgentModeChip mode="human_only" /> : <AgentStatusPill status={a.status} />}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-slate-500">
                    {human ? 'Responde tu equipo, sin IA.' : a.description || 'Sin descripción'}
                  </p>
                  {lines !== null ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-slate-400">
                      <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                      {lines === 0 ? 'No atiende a ninguna línea' : `${lines} ${lines === 1 ? 'línea' : 'líneas'}`}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-auto flex gap-2 pt-5">
                <button
                  type="button"
                  onClick={() => onConfigure(a.id)}
                  className={human ? BTN_SECONDARY : BTN_PRIMARY}
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden />
                  Configurar
                </button>
                <button type="button" onClick={() => onProbar(a.id)} className={BTN_SECONDARY}>
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
              className="flex h-full min-h-[168px] w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-slate-300 py-6 text-[13px] font-medium text-slate-500 transition-colors hover:border-[#5B6CFF]/40 hover:text-au-ink-5b6cff disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100" aria-hidden>
                <Plus className="h-4 w-4" />
              </span>
              {creating ? 'Creando…' : 'Crear agente'}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  )
}
