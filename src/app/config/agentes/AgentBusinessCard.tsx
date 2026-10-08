'use client'

import { useCallback, useEffect, useState } from 'react'

type Ownership = { salesChannels: string[]; funnels: string[]; sources: string[] }
type Settings = {
  dailyTokenCap: number | null
  orderOwnership: Ownership
  servesUnboundChannels: boolean
}

const KINDS: Array<{ key: keyof Ownership; label: string }> = [
  { key: 'sources', label: 'Página web' },
  { key: 'salesChannels', label: 'Canal de venta' },
  { key: 'funnels', label: 'Embudo' },
]

/**
 * Which orders belong to this agent's business (SQL 049) + its own daily budget.
 * Without a choice the agent only talks about orders a person linked to the chat.
 */
export function AgentBusinessCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [available, setAvailable] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [known, setKnown] = useState<Ownership>({ salesChannels: [], funnels: [], sources: [] })
  const [cap, setCap] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { available?: boolean; settings?: Settings; knownStamps?: Ownership }
      setAvailable(json.available !== false)
      if (json.settings) {
        setSettings(json.settings)
        setCap(json.settings.dailyTokenCap ? String(json.settings.dailyTokenCap) : '')
      }
      if (json.knownStamps) setKnown(json.knownStamps)
    } catch {
      /* optional card */
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(patch: Partial<Settings>) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo guardar.')
      await load()
    } catch {
      setMessage('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return null
  const own = settings.orderOwnership
  const chosen = own.salesChannels.length + own.funnels.length + own.sources.length

  function toggle(kind: keyof Ownership, value: string) {
    const list = own[kind]
    const has = list.some((v) => v.toLowerCase() === value.toLowerCase())
    const next = { ...own, [kind]: has ? list.filter((v) => v.toLowerCase() !== value.toLowerCase()) : [...list, value] }
    void save({ orderOwnership: next })
  }

  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3" data-testid="agent-business-card">
      <p className="text-[13px] font-semibold text-slate-900">Pedidos de este negocio</p>
      {!available ? (
        <p className="mt-1 text-[12px] text-slate-500">Se activa con la próxima actualización.</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-slate-500">
            {chosen === 0
              ? 'Sin elegir: el agente solo habla de pedidos que una persona vinculó al chat. Marcá de dónde vienen los pedidos de este negocio.'
              : 'El agente solo habla de pedidos de este negocio con el mismo teléfono del chat (o vinculados al chat).'}
          </p>
          {KINDS.map(({ key, label }) => {
            const values = Array.from(new Set([...own[key], ...known[key]]))
            if (values.length === 0) return null
            return (
              <div key={key} className="mt-2">
                <p className="text-[11.5px] font-medium text-slate-600">{label}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {values.map((v) => {
                    const on = own[key].some((x) => x.toLowerCase() === v.toLowerCase())
                    return (
                      <button
                        key={v}
                        type="button"
                        disabled={!canEdit || busy}
                        aria-pressed={on}
                        onClick={() => toggle(key, v)}
                        className={`rounded-full px-2.5 py-1 text-[12px] ring-1 disabled:opacity-60 ${
                          on ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {v}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          <div className="mt-3 border-t border-slate-200 pt-3">
            <p className="text-[12.5px] font-medium text-slate-800">Límite diario de este agente</p>
            <p className="mt-0.5 text-[11.5px] text-slate-500">Tokens por día. Vacío = solo el límite del negocio.</p>
            <div className="mt-1 flex gap-2">
              <input
                value={cap}
                onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ''))}
                disabled={!canEdit || busy}
                inputMode="numeric"
                placeholder="Sin límite propio"
                aria-label="Límite diario de tokens"
                className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-900"
              />
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save({ dailyTokenCap: cap ? Number(cap) : null })}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                >
                  Guardar
                </button>
              ) : null}
            </div>
          </div>

          <label className="mt-3 flex items-start gap-2 text-[12.5px] text-slate-800">
            <input
              type="checkbox"
              checked={settings.servesUnboundChannels}
              disabled={!canEdit || busy}
              onChange={(e) => void save({ servesUnboundChannels: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Si es el agente por defecto, responder también en canales sin agente propio
              <span className="block text-[11.5px] text-slate-500">Apagado: cada canal responde solo con su propio agente.</span>
            </span>
          </label>
          {message ? <p className="mt-2 text-[12px] text-red-700">{message}</p> : null}
        </>
      )}
    </div>
  )
}
