'use client'

import { ArrowLeft, Check, FlaskConical, UserRound } from 'lucide-react'
import { AgentModeChip, AgentStatusPill } from './AgentChips'
import { AgentTabBar } from './AgentTabBar'
import { AgentFace, agentTitleParts, type FaceSource } from './AgentFace'
import type { AgentTab } from './agent-url'

type Props = {
  /** Agent identity for its face + title (`introductionNames[0]` is the customer-facing name). */
  agent: FaceSource
  status: string
  /** Operation mode chip (saved agents only). */
  mode?: string
  /** Real bound lines, or a plain sentence such as "No atiende a ninguna línea". */
  subtitle: string
  tab: AgentTab
  onTab: (tab: AgentTab) => void
  disabledTabs?: ReadonlyArray<AgentTab>
  onBack: () => void
  onProbar?: () => void
  onPublish: () => void
  publishLabel?: string
  publishing?: boolean
  publishDisabled?: boolean
  /** "Cambios guardados · v3" after a flush. */
  publishNote?: string | null
}

/** Aurora agent header (frame 192:2569): avatar, name, status pill, lines it serves, actions, tabs. */
export function AgentDetailHeader({
  agent,
  status,
  mode,
  subtitle,
  tab,
  onTab,
  disabledTabs,
  onBack,
  onProbar,
  onPublish,
  publishLabel = 'Publicar cambios',
  publishing = false,
  publishDisabled = false,
  publishNote,
}: Props) {
  const { persona, internal } = agentTitleParts(agent)
  return (
    <div data-testid="agent-detail-header">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-slate-900 md:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Agentes IA
      </button>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {mode === 'human_only' ? (
            <span
              className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[30%] bg-slate-100 text-slate-500"
              aria-hidden
            >
              <UserRound className="h-6 w-6" />
            </span>
          ) : (
            <AgentFace agent={agent} size={52} state={publishing ? 'think' : 'idle'} />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[22px] font-semibold leading-tight text-au-ink-0e0d17">
                {persona ? (
                  <>
                    {persona}
                    <span className="font-normal text-slate-400"> · </span>
                    <span className="font-medium text-slate-600">{internal}</span>
                  </>
                ) : (
                  internal
                )}
              </h2>
              <AgentStatusPill status={status} />
              {mode ? <AgentModeChip mode={mode} /> : null}
            </div>
            <p className="mt-0.5 text-[13px] text-slate-500" data-testid="agent-lines-subtitle">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {publishNote ? (
            <span role="status" className="text-[12px] text-emerald-700">
              {publishNote}
            </span>
          ) : null}
          {onProbar ? (
            <button
              type="button"
              onClick={onProbar}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-medium text-au-ink-0e0d17 hover:bg-slate-50"
            >
              <FlaskConical className="h-4 w-4" aria-hidden />
              Probar
            </button>
          ) : null}
          <button
            type="button"
            onClick={onPublish}
            disabled={publishDisabled || publishing}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] px-4 text-[13px] font-medium text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check className="h-4 w-4" aria-hidden />
            {publishing ? 'Guardando…' : publishLabel}
          </button>
        </div>
      </div>
      <div className="mt-5">
        <AgentTabBar tab={tab} onSelect={onTab} disabledTabs={disabledTabs} />
      </div>
    </div>
  )
}
