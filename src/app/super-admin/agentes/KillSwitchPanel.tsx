'use client'

import { useCallback, useEffect, useState } from 'react'

type KillState = {
  env: boolean
  global: boolean
  tenants: Array<{ tenantId: string; reason: string | null }>
}

/** Emergency stop for ALL inbox agents (no model calls, no sends, no suggestions). Probar still works. */
export default function KillSwitchPanel() {
  const [state, setState] = useState<KillState | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/super-admin/agent-kill', { cache: 'no-store' })
      if (res.ok) setState((await res.json()) as KillState)
    } catch {
      /* panel is optional; the dashboard still works */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(armed: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/super-admin/agent-kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'global', armed, reason }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo cambiar.')
      else {
        setReason('')
        setMessage(armed ? 'Agentes frenados.' : 'Agentes reanudados.')
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

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
        las personas. Probar sigue funcionando.
        {state?.env ? ' (Activo por la variable SOFT_AGENT_KILL del servidor.)' : ''}
      </p>
      {state?.tenants.length ? (
        <p className="mt-1 text-[12px] text-red-800">
          Negocios frenados: {state.tenants.map((t) => t.tenantId).join(', ')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo (obligatorio)"
          maxLength={200}
          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-[13px]"
        />
        {state?.global ? (
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
