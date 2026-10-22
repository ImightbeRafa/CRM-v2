'use client'

import { MobileCardTable } from '@/components/ui/MobileCardTable'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'

type Row = {
  id: string
  name: string
  plan: string
  isActive: boolean
  agentCount: number
  activeBindings: number
  customAgents: { enabled: boolean; agentIds: string[]; enabledAt: string | null; updatedAt: string } | null
}
type Agent = { id: string; name: string; status: string; operationMode: string }

/**
 * "Agente personalizado" per business (Rafael only). On = the business sees and edits its agent;
 * off = the Agents tab shows the sales page and the agent APIs answer 403. Only enforced while
 * SUPPORT_PIPELINE_ENABLED=true. Turning it off does NOT stop a live agent from replying — use the
 * emergency stop above for that. Every change is audited.
 */
export default function CustomAgentAccessPanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [gateActive, setGateActive] = useState(false)
  const [query, setQuery] = useState('')
  const [onlyRelevant, setOnlyRelevant] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/custom-agents', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as { gateActive: boolean; tenants: Row[] }
      setRows(json.tenants)
      setGateActive(json.gateActive)
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.id.includes(q)) return false
      if (onlyRelevant && !q) return r.agentCount > 0 || r.customAgents !== null
      return true
    })
  }, [rows, query, onlyRelevant])

  async function openRow(row: Row) {
    if (openId === row.id) {
      setOpenId(null)
      return
    }
    setOpenId(row.id)
    setAgents([])
    setPicked(row.customAgents?.agentIds ?? [])
    const res = await fetch(`/api/super-admin/tenants/${encodeURIComponent(row.id)}/custom-agents`, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setAgents(((await res.json()) as { agents: Agent[] }).agents)
  }

  async function save(row: Row, enabled: boolean) {
    const verb = enabled ? 'Activar' : 'Desactivar'
    const ok = await auroraConfirm(
      `${verb} el agente personalizado de ${row.name}?\n${
        enabled
          ? 'El negocio verá su agente en la pestaña Agentes y le avisamos por correo al dueño.'
          : 'El negocio verá la página de venta; su agente en vivo sigue respondiendo (usá el freno para pararlo).'
      }`,
    )
    if (!ok) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/super-admin/tenants/${encodeURIComponent(row.id)}/custom-agents`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Agent ids only for the row whose list is open (else the server keeps the saved ones).
        body: JSON.stringify(openId === row.id ? { enabled, agentIds: picked } : { enabled }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; ownerNotified?: boolean }
      if (!res.ok) setMessage(json.error || 'No se pudo guardar.')
      else {
        setMessage(`${row.name}: ${enabled ? 'activado' : 'desactivado'}${json.ownerNotified ? ' (dueño avisado por correo)' : ''}.`)
        await load()
      }
    } catch {
      setMessage('Sin conexión. No se cambió nada.')
    } finally {
      setBusy(false)
    }
  }

  if (loadFailed && !rows) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
        No se pudo leer el acceso a agentes.{' '}
        <button type="button" className="underline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    )
  }
  if (!rows) return null

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="custom-agent-access-panel">
      <h3 className="text-[14px] font-semibold text-slate-900">Agente personalizado por negocio</h3>
      <p className="mt-1 text-[12px] text-slate-600">
        {gateActive
          ? 'Activo: solo los negocios encendidos ven y editan su agente; el resto ve la página de venta.'
          : 'Todavía sin efecto (SUPPORT_PIPELINE_ENABLED apagado): hoy todos los negocios ven su editor. Encendé antes a los que ya tienen agente.'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar negocio"
          aria-label="Buscar negocio"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]"
        />
        <label className="flex items-center gap-2 text-[12px] text-slate-600">
          <input type="checkbox" checked={onlyRelevant} onChange={(e) => setOnlyRelevant(e.target.checked)} />
          Solo con agentes o con el interruptor puesto
        </label>
      </div>
      {message && <p className="mt-2 text-[12px] text-slate-700" role="status">{message}</p>}
      <MobileCardTable className="mt-3 overflow-x-auto">
        <table className="m-cards w-full text-left text-[12px]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Negocio</th>
              <th className="py-1 pr-3 font-medium">Agentes</th>
              <th className="py-1 pr-3 font-medium">Bindings activos</th>
              <th className="py-1 pr-3 font-medium">Estado</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const on = r.customAgents?.enabled === true
              const atRisk = !on && r.activeBindings > 0
              return (
                <tr key={r.id} className="align-top">
                  <td className="py-2 pr-3">
                    <button type="button" className="text-left font-medium text-slate-900 hover:underline" onClick={() => void openRow(r)}>
                      {r.name}
                    </button>
                    <span className="block font-mono text-[11px] text-slate-400">{r.id} · {r.plan}</span>
                    {openId === r.id && (
                      <div className="mt-2 space-y-1">
                        {agents.length === 0 ? (
                          <p className="text-slate-500">Sin agentes todavía.</p>
                        ) : (
                          agents.map((a) => (
                            <label key={a.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={picked.includes(a.id)}
                                onChange={(e) =>
                                  setPicked((p) => (e.target.checked ? [...p, a.id] : p.filter((x) => x !== a.id)))
                                }
                              />
                              {a.name} <span className="text-slate-400">({a.status}, {a.operationMode})</span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2 pr-3">{r.agentCount}</td>
                  <td className="py-2 pr-3">{r.activeBindings}</td>
                  <td className="py-2 pr-3">
                    {on ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Encendido</span>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 ${atRisk ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                        {atRisk ? 'Apagado (tiene agente activo)' : 'Apagado'}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save(r, !on)}
                      className="rounded-md bg-white px-2 py-0.5 text-[12px] text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
                    >
                      {on ? 'Desactivar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {visible.length === 0 && <p className="py-3 text-[12px] text-slate-500">Ningún negocio coincide.</p>}
      </MobileCardTable>
    </div>
  )
}
