'use client'

import { useCallback, useEffect, useState } from 'react'

type TermsState = {
  version: string
  accepted: boolean
  record: { version: string; acceptedAt: string; acceptedByName: string } | null
  title: string
  points: string[]
  checkbox: string
  links: { privacy: string; privacyEn: string }
}

/** Business opt-in for AI features: required before any agent sends customer messages to an AI provider. */
export function AiTermsCard({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<TermsState | null>(null)
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/agents/ai-terms', { cache: 'no-store' })
      if (res.ok) setState((await res.json()) as TermsState)
    } catch {
      /* optional */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function send(accept: boolean) {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/agents/ai-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept, version: state.version }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(json.error || 'No se pudo guardar.')
      else setChecked(false)
      await load()
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (!state) return null
  if (state.accepted && state.record) {
    const when = new Date(state.record.acceptedAt)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] text-emerald-900 ring-1 ring-emerald-100" data-testid="ai-terms-accepted">
        <span>
          Uso de IA autorizado por {state.record.acceptedByName || 'el negocio'}
          {Number.isNaN(when.getTime()) ? '' : ` el ${when.toLocaleDateString('es-CR', { dateStyle: 'medium' })}`}.{' '}
          <a href={state.links.privacy} className="underline" target="_blank" rel="noreferrer">
            Política de privacidad
          </a>
        </span>
        {canEdit ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (window.confirm('¿Revocar la autorización? Los agentes dejarán de generar respuestas y sugerencias.')) void send(false)
            }}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-emerald-900 ring-1 ring-emerald-200 disabled:opacity-50"
          >
            Revocar
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-amber-50 px-4 py-4 text-[13px] text-amber-950 ring-1 ring-amber-200" data-testid="ai-terms-pending" role="region" aria-label="Autorización de IA">
      <h2 className="text-[14px] font-semibold">{state.title}</h2>
      <p className="mt-1 text-[12.5px]">
        Mientras no se acepte, los agentes <strong>no responden ni sugieren</strong>: ningún mensaje de sus clientes se envía a un proveedor de IA.
        Las pruebas (Probar) siguen funcionando con mensajes que escribe su equipo.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px]">
        {state.points.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
      <p className="mt-2 text-[12px]">
        Documentos:{' '}
        <a href={state.links.privacy} className="underline" target="_blank" rel="noreferrer">
          Política de privacidad (español)
        </a>{' '}
        ·{' '}
        <a href={state.links.privacyEn} className="underline" target="_blank" rel="noreferrer">
          Privacy Policy (English)
        </a>
      </p>
      {canEdit ? (
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>{state.checkbox}</span>
          </label>
          <button
            type="button"
            disabled={!checked || busy}
            onClick={() => void send(true)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Autorizar el uso de IA'}
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[12px] font-medium">Solo el propietario o un administrador puede autorizarlo.</p>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  )
}
