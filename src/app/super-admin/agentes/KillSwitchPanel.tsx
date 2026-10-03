'use client'

import { useCallback, useEffect, useState } from 'react'

type KillState = {
  env: boolean
  global: boolean
  tenants: Array<{ tenantId: string; reason: string | null }>
}

/** Emergency stop for ALL inbox agents (no model calls, no sends, no suggestions) and all AI test calls. */
export default function KillSwitchPanel() {
  const [state, setState] = useState<KillState | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/agent-kill', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      setState((await res.json()) as KillState)
      setLoadFailed(false)
    } catch {
      // Unknown state must never look like "not armed" (that would invite a wrong click).
      setLoadFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(armed: boolean, tenantId?: string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/super-admin/agent-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tenantId ? { scope: 'tenant', tenantId, armed, reason } : { scope: 'global', armed, reason }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo cambiar.')
      else {
        if (tenantId) setMessage('Negocio reanudado.')
        setReason('')
        if (!tenantId) setMessage(armed ? 'Agentes frenados.' : 'Agentes reanudados.')
        await load()
      }
    } catch {
      setMessage('Sin conexión. No se cambió nada.')
    } finally {
      setBusy(false)
    }
  }

  if (loadFailed && !state) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900" data-testid="agent-kill-panel">
        No se pudo leer el estado del freno de emergencia.{' '}
        <button type="button" className="underline" onClick={() => void load()}>
          Reintentar
        </button>
      </div>
    )
  }
  if (!state) return null

  const armed = Boolean(state?.env || state?.global)
  return (
    <div
      className={`rounded-xl border p-4 ${armed ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}
      data-testid="agent-kill-panel"
    >
      <h3 className="text-[14px] font-semibold text-slate-900">
        {armed ? 'FRENO ACTIVO: los agentes no responden' : 'Freno de emergencia'}
      </h3>
      <p className="mt-1 text-[12px] text-slate-600">
        Frena a todos los agentes del inbox: sin respuestas, sin sugerencias. Los mensajes siguen llegando a
        las personas. También detiene las pruebas (Probar) y la importación con IA de todos los negocios.
        {state.env ? ' (Activo por la variable SOFT_AGENT_KILL del servidor: se quita desde Cloudflare.)' : ''}
      </p>
      {state.tenants.length ? (
        <ul className="mt-2 space-y-1 text-[12px] text-red-800">
          {state.tenants.map((t) => (
            <li key={t.tenantId} className="flex flex-wrap items-center gap-2">
              <span>
                Negocio frenado <span className="font-mono">{t.tenantId}</span>
                {t.reason ? ` — ${t.reason}` : ''}
              </span>
              <button
                type="button"
                disabled={busy || reason.trim().length < 3}
                title={reason.trim().length < 3 ? 'Escribí el motivo primero' : undefined}
                onClick={() => void toggle(false, t.tenantId)}
                className="rounded-md bg-white px-2 py-0.5 text-[12px] text-slate-800 ring-1 ring-slate-300 disabled:opacity-50"
              >
                Reanudar este negocio
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="kill-reason" className="sr-only">
          Motivo
        </label>
        <input
          id="kill-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (obligatorio)"
          maxLength={200}
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]"
        />
        {state.global ? (
          <button
            type="button"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void toggle(false)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            Reanudar agentes
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || reason.trim().length < 3}
            onClick={() => void toggle(true)}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
          >
            Frenar todos los agentes
          </button>
        )}
      </div>
      {message ? <p className="mt-2 text-[12px] text-slate-700">{message}</p> : null}
    </div>
  )
}
