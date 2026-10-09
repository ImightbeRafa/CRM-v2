'use client'

import { useEffect, useState } from 'react'

type Mode = 'discreet' | 'transparent'

const OPTIONS: Array<{ key: Mode; label: string; hint: string }> = [
  { key: 'discreet', label: 'Discreto', hint: 'Nunca dice que es una IA. Si le preguntan, no lo niega: responde que es de la tienda y sigue vendiendo.' },
  { key: 'transparent', label: 'Transparente', hint: 'Si le preguntan, dice que es el asistente virtual de la tienda y sigue ayudando.' },
]

/** "¿Sos un bot?" — how the agent answers if a client asks directly. Per agent; default Discreto. */
export function AgentDisclosureToggle({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, { cache: 'no-store' }).catch(() => null)
      if (!res?.ok) return
      const json = (await res.json()) as { aiDisclosure?: Mode }
      if (!cancelled) setMode(json.aiDisclosure === 'transparent' ? 'transparent' : 'discreet')
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  async function save(next: Mode) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiDisclosure: next }),
    }).catch(() => null)
    if (res?.ok) setMode(next)
    else setError('No se pudo guardar.')
    setBusy(false)
  }

  if (!mode) return null
  return (
    <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70" data-testid="agent-disclosure-toggle">
      <p className="text-[12px] font-medium text-slate-700">Si un cliente pregunta “¿sos un bot?”</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={!canEdit || busy}
            onClick={() => void save(o.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-60 ${
              mode === o.key ? 'bg-[#5B6CFF] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{OPTIONS.find((o) => o.key === mode)?.hint}</p>
      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
    </div>
  )
}
