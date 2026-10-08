'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { SourcesStep } from './SourcesStep'
import { ReviewStep } from './ReviewStep'
import type { Draft, InventoryOption, StudioSource } from './studio-types'

const ERROR_TEXT: Record<string, string> = {
  cost_cap: 'Las fuentes son demasiado largas para un solo borrador. Quitá alguna y probá de nuevo.',
  bad_json: 'La IA devolvió algo que no pudimos leer. Probá de nuevo.',
  model_error: 'La IA no respondió a tiempo. Probá de nuevo.',
  interrupted: 'Se interrumpió. Probá de nuevo.',
  no_sources: 'No hay fuentes con texto.',
  ai_paused: 'La IA de este negocio está en pausa (presupuesto o pausa general).',
  too_long: 'Tus fuentes tienen demasiado contenido para un solo borrador. Quitá alguna (por ejemplo el catálogo completo) y probá de nuevo.',
}

/**
 * "Crear desde fuentes": 1) give the business's material → 2) AI draft with where each fact came from →
 * 3) owner checks and applies → then "Probar y activar" (the agent's own tests) below.
 */
export function StudioFlow({
  agentId,
  canEdit,
  isLive = false,
  onApplied,
}: {
  agentId: string
  canEdit: boolean
  isLive?: boolean
  onApplied?: () => void
}) {
  const [sources, setSources] = useState<StudioSource[]>([])
  const [ig, setIg] = useState<Array<{ id: string; label: string }>>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [inventory, setInventory] = useState<InventoryOption[]>([])
  const [current, setCurrent] = useState<{ sinpe: string | null; iban: string | null; website: string | null; share?: boolean } | null>(null)
  const [notReady, setNotReady] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const timer = useRef<number | null>(null)
  const base = `/api/chat/agents/${encodeURIComponent(agentId)}/studio`

  const loadSources = useCallback(async () => {
    const res = await fetch(`${base}/sources`, { cache: 'no-store' }).catch(() => null)
    if (!res) return
    if (res.status === 409) {
      setNotReady(true)
      return
    }
    if (!res.ok) return
    const json = (await res.json()) as { sources: StudioSource[]; instagramAccounts: Array<{ id: string; label: string }> }
    setSources(json.sources)
    setIg(json.instagramAccounts)
  }, [base])

  const loadDraft = useCallback(async () => {
    const res = await fetch(`${base}/draft`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return
    const json = (await res.json()) as { draft: Draft | null; inventory: InventoryOption[]; current?: { sinpe: string | null; iban: string | null; website: string | null; share?: boolean } }
    setDraft(json.draft)
    setInventory(json.inventory)
    setCurrent(json.current ?? null)
  }, [base])

  useEffect(() => {
    void loadSources()
    void loadDraft()
  }, [loadSources, loadDraft])

  // Poll while the AI is reading (one extraction takes ~20–90 s).
  useEffect(() => {
    const working = draft?.status === 'queued' || draft?.status === 'extracting' || draft?.status === 'applying'
    if (!working) return
    timer.current = window.setTimeout(() => void loadDraft(), 3000)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [draft, loadDraft])

  async function start() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const json = (await res.json().catch(() => ({}))) as { draft?: Draft; error?: string }
      if (!res.ok || !json.draft) setMessage(json.error || 'No se pudo empezar.')
      else setDraft(json.draft)
    } catch {
      setMessage('Sin conexión. Probá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!draft) return
    setBusy(true)
    await fetch(`${base}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'discard', draftId: draft.id }),
    }).catch(() => null)
    setBusy(false)
    void loadDraft()
  }

  const parsed = sources.filter((s) => s.status === 'parsed').length
  const working = draft?.status === 'queued' || draft?.status === 'extracting' || draft?.status === 'applying'
  const step = draft?.status === 'ready' ? 2 : draft?.status === 'applied' ? 3 : 1

  if (notReady) return null

  return (
    <div className="rounded-2xl border border-[#5B6CFF]/25 bg-white p-4 md:p-5" data-testid="studio-flow">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left" aria-expanded={open}>
        <div>
          <h3 className="text-[14px] font-semibold text-slate-900">✨ Crear desde fuentes</h3>
          <p className="text-[12px] text-slate-500">Sitio web, catálogos, fotos o Instagram → el agente aprende tu negocio.</p>
        </div>
        <span aria-hidden className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-4">
          <ol className="flex gap-2 text-[11px] font-medium" aria-label="Pasos">
            {['Fuentes', 'Revisar', 'Probar'].map((label, i) => (
              <li key={label} className={`flex-1 rounded-full px-2 py-1 text-center ${step === i + 1 ? 'bg-[#5B6CFF] text-white' : step > i + 1 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {i + 1}. {label}
              </li>
            ))}
          </ol>

          {step === 1 || working ? (
            <>
              <SourcesStep agentId={agentId} sources={sources} instagramAccounts={ig} canEdit={canEdit && !working} onChanged={() => void loadSources()} />
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy || working || parsed === 0}
                  onClick={() => void start()}
                  className="min-h-[44px] w-full rounded-xl bg-[#5B6CFF] px-4 text-[14px] font-semibold text-white disabled:opacity-40"
                  data-testid="studio-start"
                >
                  {draft?.status === 'applying' ? 'Aplicando el borrador…' : working ? 'La IA está leyendo tus fuentes…' : `Leer ${parsed} fuente(s) con IA`}
                </button>
              ) : null}
              {draft?.status === 'failed' || draft?.status === 'cost_capped' ? (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100">
                  {ERROR_TEXT[draft.errorCode || ''] || 'No se pudo armar el borrador. Probá de nuevo.'}
                </p>
              ) : null}
            </>
          ) : null}

          {step === 2 && draft?.profile ? (
            <ReviewStep
              key={draft.id}
              agentId={agentId}
              draft={draft}
              inventory={inventory}
              canEdit={canEdit}
              isLive={isLive}
              current={current}
              onDiscard={() => void discard()}
              onApplied={(summary) => {
                setMessage(summary)
                void loadDraft()
                onApplied?.()
              }}
            />
          ) : null}

          {step === 3 ? (
            <div className="space-y-2 rounded-xl bg-emerald-50 px-3 py-3 text-[13px] text-emerald-900 ring-1 ring-emerald-100">
              <p className="font-medium">{message || 'Aplicado al agente.'}</p>
              <p className="text-[12px]">
                {isLive
                  ? 'El agente ya está activo: estos cambios ya los usa. Corré “Probar y activar” para confirmar que sigue pasando sus pruebas.'
                  : 'Ahora usá “Probar y activar” en la línea del agente: corre sus pruebas y, si pasan, lo activás con un clic.'}
              </p>
              {canEdit ? (
                <button type="button" onClick={() => setDraft(null)} className="text-[12px] font-medium text-au-ink-5b6cff">
                  Agregar más fuentes
                </button>
              ) : null}
            </div>
          ) : null}

          {message && step !== 3 ? <p className="text-[12px] text-slate-600">{message}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
