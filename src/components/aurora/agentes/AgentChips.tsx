const STATUS: Record<string, { label: string; cls: string }> = {
  live: { label: 'En vivo', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  draft: { label: 'Borrador', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  archived: { label: 'Archivado', cls: 'bg-amber-50 text-amber-700 ring-amber-100' },
}

const MODE: Record<string, string> = {
  ai_suggest: 'Sugerir',
  ai_full: 'Responder',
  human_only: 'Solo humanos',
}

const CHIP = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1'

export function AgentStatusChip({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-slate-100 text-slate-600 ring-slate-200' }
  return <span className={`${CHIP} ${s.cls}`}>{s.label}</span>
}

export function agentModeLabel(mode: string): string {
  return MODE[mode] ?? mode
}

export function AgentModeChip({ mode }: { mode: string }) {
  return (
    <span className={`${CHIP} bg-[#EEF0FF] text-[#5B6CFF] ring-[#5B6CFF]/15`}>
      {agentModeLabel(mode)}
    </span>
  )
}

/** Honest bind chip: shown when the agent has no bound line (attends nobody). */
export function AgentNoChannelsChip() {
  return (
    <span className={`${CHIP} bg-red-50 text-red-600 ring-red-100`}>Sin canales</span>
  )
}
