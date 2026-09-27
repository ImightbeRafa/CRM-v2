'use client'

import { AGENT_SECTIONS, type AgentTab } from './agent-url'

/** Figma underline tab bar. Scrolls horizontally on narrow screens; `disabled` tabs need a saved agent. */
export function AgentTabBar({
  tab,
  onSelect,
  disabledTabs = [],
}: {
  tab: AgentTab
  onSelect: (tab: AgentTab) => void
  disabledTabs?: ReadonlyArray<AgentTab>
}) {
  return (
    <div
      role="tablist"
      aria-label="Secciones del agente"
      data-testid="agent-tabbar"
      className="-mb-px flex snap-x gap-5 overflow-x-auto border-b border-slate-200/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {AGENT_SECTIONS.map((t) => {
        const active = tab === t.key
        const disabled = disabledTabs.includes(t.key)
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            title={disabled ? 'Guardá el agente primero' : undefined}
            onClick={() => onSelect(t.key)}
            className={`min-h-[40px] shrink-0 snap-start whitespace-nowrap border-b-2 px-0.5 pb-2.5 pt-1 text-[13px] font-medium transition-colors ${
              active
                ? 'border-[#5B6CFF] text-[#0E0D17]'
                : disabled
                  ? 'cursor-not-allowed border-transparent text-slate-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
