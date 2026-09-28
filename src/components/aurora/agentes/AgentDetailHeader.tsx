'use client'

import { ArrowLeft, Check, FlaskConical } from 'lucide-react'
import { AgentModeChip, AgentStatusPill } from './AgentChips'
import { AgentTabBar } from './AgentTabBar'
import type { AgentTab } from './agent-url'

type Props = {
  emoji: string
  name: string
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
  emoji,
  name,
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
          <span
            className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-2xl shadow-sm"
            aria-hidden
          >
            {emoji || '🤖'}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[22px] font-semibold leading-tight text-[#0E0D17]">{name}</h2>
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
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-medium text-[#0E0D17] hover:bg-slate-50"
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
