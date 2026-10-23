'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { PlateSwatch } from '@/components/brand/AgentMark'
import {
  AGENT_PLATES,
  AGENT_PLATE_LABELS,
  DISPLAY_NAME_MAX,
  resolveAgentAppearance,
  type AgentAppearance,
  type AgentPlate,
} from '@/lib/agent-appearance'
import { AgentFace, type FaceSource } from './AgentFace'

type Props = {
  agent: FaceSource & { id: string }
  canEdit: boolean
  onSaved: (agentId: string, appearance: Partial<AgentAppearance>) => void
}

/**
 * "Apariencia": how the agent looks in Betsy (owner UI only). The Betsy mark itself never changes;
 * the owner picks the plate color, an optional ring and the label shown next to it.
 */
export function AgentAppearanceCard({ agent, canEdit, onSaved }: Props) {
  const current = resolveAgentAppearance(agent, agent.appearance)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Partial<Pick<AgentAppearance, 'plate' | 'ring' | 'displayName'>>) {
    if (!canEdit || busy) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/chat/agents/appearance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: agent.id, ...patch }),
    }).catch(() => null)
    const json = (await res?.json().catch(() => null)) as { success?: boolean; appearance?: Partial<AgentAppearance>; error?: string } | null
    if (res?.ok && json?.success && json.appearance) onSaved(agent.id, json.appearance)
    else setError(json?.error || 'No se pudo guardar.')
    setBusy(false)
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5" data-testid="agent-appearance">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">Apariencia</h3>
          <p className="mt-0.5 text-[12px] text-slate-500">Cómo se ve este agente dentro de Betsy. Tus clientes no lo ven.</p>
        </div>
        <AgentFace agent={agent} size={52} animated={false} />
      </div>

      <p className="mt-4 text-xs font-medium text-slate-700">Color</p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Color del agente">
        {AGENT_PLATES.map((plate: AgentPlate) => {
          const on = current.plate === plate
          return (
            <button
              key={plate}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={AGENT_PLATE_LABELS[plate]}
              title={AGENT_PLATE_LABELS[plate]}
              disabled={!canEdit || busy}
              onClick={() => void save({ plate })}
              className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-shadow disabled:cursor-not-allowed disabled:opacity-60 ${
                on ? 'ring-2 ring-slate-900/70 ring-offset-2' : 'hover:ring-2 hover:ring-slate-300 hover:ring-offset-2'
              }`}
            >
              <PlateSwatch plate={plate} />
              {on ? <Check className="absolute h-3.5 w-3.5 text-white" strokeWidth={3} aria-hidden /> : null}
            </button>
          )
        })}
      </div>

      <label className="mt-4 flex items-center gap-2 text-[13px] text-slate-700">
        <input
          type="checkbox"
          checked={current.ring}
          disabled={!canEdit || busy}
          onChange={(e) => void save({ ring: e.target.checked })}
        />
        Mostrar aro de color
      </label>

      <label htmlFor={`agent-display-${agent.id}`} className="mt-4 block text-xs font-medium text-slate-700">
        Nombre que se muestra
      </label>
      <p className="mt-0.5 text-[11px] text-slate-500">Vacío = el primer nombre de presentación.</p>
      <input
        id={`agent-display-${agent.id}`}
        key={`display-${agent.id}-${agent.appearance?.displayName ?? ''}`}
        autoComplete="off"
        data-lpignore="true"
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-500 disabled:bg-slate-100"
        defaultValue={agent.appearance?.displayName ?? ''}
        placeholder={(agent.introductionNames ?? []).find((n) => n.trim()) || agent.name}
        maxLength={DISPLAY_NAME_MAX}
        disabled={!canEdit || busy}
        onBlur={(e) => {
          const value = e.target.value.trim()
          if (value !== (agent.appearance?.displayName ?? '')) void save({ displayName: value || null })
        }}
      />
      {error ? <p className="mt-2 text-[12px] text-red-700">{error}</p> : null}
    </div>
  )
}
