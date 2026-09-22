'use client'

import React, { useState } from 'react'

type FactRow = {
  id: string
  path: string
  label: string
  value: string
  confidence: 'high' | 'medium' | 'low'
}

type ShortcutRow = {
  id: string
  key: string
  title: string
  body: string
  confidence: 'high' | 'medium' | 'low'
  validation: { ok: true } | { ok: false; code: string }
}

type Proposal = {
  extractionId: string
  source: string
  facts: FactRow[]
  shortcuts: ShortcutRow[]
}

const FIELD =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-500 disabled:bg-slate-100 disabled:!text-slate-600'
const HINT = 'text-[11px] text-slate-600'

function confidenceClass(level: FactRow['confidence']) {
  if (level === 'high') return 'bg-emerald-50 text-emerald-900'
  if (level === 'medium') return 'bg-amber-50 text-amber-950'
  return 'bg-slate-100 text-slate-700'
}

export function ShortcutPasteImport({
  agentId,
  canEdit,
  onApplied,
}: {
  agentId: string
  canEdit: boolean
  onApplied: () => void
}) {
  const [paste, setPaste] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [facts, setFacts] = useState<FactRow[]>([])
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>([])
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  function takeProposal(next: Proposal) {
    setProposal(next)
    setFacts(next.facts)
    setShortcuts(next.shortcuts)
    const flags: Record<string, boolean> = {}
    for (const row of next.facts) flags[row.id] = true
    for (const row of next.shortcuts) flags[row.id] = row.validation.ok
    setIncluded(flags)
    setSaved(null)
  }

  async function extract() {
    if (!canEdit || busy) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/import/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paste }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          data.code === 'paste_too_long'
            ? 'El texto pasa de 8.000 caracteres.'
            : data.code === 'TEST_BUDGET_BLOCKED'
              ? 'Se agotó el cupo de prueba de hoy.'
              : 'No se pudo leer el texto.',
        )
      }
      setToken(typeof data.proposalToken === 'string' ? data.proposalToken : null)
      takeProposal(data.proposal as Proposal)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!canEdit || busy || !proposal || !token) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/import/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: 1,
          reviewed: true,
          proposalToken: token,
          facts: facts.map((row) => ({
            id: row.id,
            decision: included[row.id] ? 'include' : 'exclude',
            value: row.value,
          })),
          shortcuts: shortcuts.map((row) => ({
            id: row.id,
            decision: included[row.id] && row.validation.ok ? 'include' : 'exclude',
            title: row.title,
            body: row.body,
            isActive: true,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(
          data.code === 'confirmation_wording'
            ? 'Hay un texto que confirma un pago. Desmarcalo para guardar el resto.'
            : 'No se pudo guardar.',
        )
      }
      setSaved(data.applied === false ? 'Ese guardado ya estaba aplicado.' : 'Listo. Los datos quedaron guardados.')
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = Object.values(included).filter(Boolean).length

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Cargar desde mis atajos</h2>
      <p className={`mt-0.5 ${HINT}`}>
        Pegá el texto que ya usan en WhatsApp. Revisá la lista y guardá una sola vez. Nada se escribe antes.
      </p>
      <textarea
        className={`mt-3 ${FIELD}`}
        rows={6}
        maxLength={8000}
        value={paste}
        disabled={!canEdit || busy}
        placeholder="Horario, SINPE, envíos, respuestas listas…"
        onChange={(e) => setPaste(e.target.value)}
      />
      <div className="mt-1 flex items-center justify-between">
        <p className={HINT}>{paste.trim().length} / 8000</p>
        <button
          type="button"
          disabled={!canEdit || busy || !paste.trim()}
          onClick={() => void extract()}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-900 ring-1 ring-slate-200 disabled:bg-slate-100 disabled:!text-slate-600"
        >
          {busy ? 'Leyendo…' : 'Leer atajos'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {proposal ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium text-slate-900">Revisá antes de guardar</p>
          <ul className="space-y-2">
            {facts.map((row) => (
              <li key={row.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-900">
                    <input
                      type="checkbox"
                      checked={Boolean(included[row.id])}
                      disabled={!canEdit}
                      onChange={(e) => setIncluded((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                    />
                    {row.label}
                  </label>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${confidenceClass(row.confidence)}`}>
                    {row.confidence === 'high' ? 'alta' : row.confidence === 'medium' ? 'media' : 'baja'}
                  </span>
                </div>
                <input
                  className={`mt-2 ${FIELD}`}
                  value={row.value}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setFacts((prev) => prev.map((item) => (item.id === row.id ? { ...item, value: e.target.value } : item)))
                  }
                />
              </li>
            ))}
            {shortcuts.map((row) => {
              const blocked = !row.validation.ok
              return (
                <li
                  key={row.id}
                  className={`rounded-lg p-3 ring-1 ${blocked ? 'bg-red-50 ring-red-100' : 'bg-slate-50 ring-slate-100'}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className={`inline-flex items-center gap-2 text-sm font-medium ${blocked ? 'text-red-900' : 'text-slate-900'}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(included[row.id]) && !blocked}
                        disabled={!canEdit || blocked}
                        onChange={(e) => setIncluded((prev) => ({ ...prev, [row.id]: e.target.checked }))}
                      />
                      {blocked ? 'No se puede guardar' : 'Respuesta'}
                    </label>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${blocked ? 'bg-red-100 text-red-900' : confidenceClass(row.confidence)}`}>
                      {blocked ? 'rechazada' : row.confidence === 'high' ? 'alta' : row.confidence === 'medium' ? 'media' : 'baja'}
                    </span>
                  </div>
                  {blocked ? (
                    <p className="mt-2 text-xs text-red-800">
                      Ese texto confirma un pago. No se guarda.
                    </p>
                  ) : null}
                  <input
                    className={`mt-2 ${FIELD}`}
                    value={row.title}
                    disabled={!canEdit || blocked}
                    onChange={(e) =>
                      setShortcuts((prev) => prev.map((item) => (item.id === row.id ? { ...item, title: e.target.value } : item)))
                    }
                  />
                  <textarea
                    className={`mt-2 ${FIELD}`}
                    rows={3}
                    value={row.body}
                    disabled={!canEdit || blocked}
                    onChange={(e) =>
                      setShortcuts((prev) => prev.map((item) => (item.id === row.id ? { ...item, body: e.target.value } : item)))
                    }
                  />
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            disabled={!canEdit || busy || !token || selectedCount === 0}
            onClick={() => void apply()}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:bg-indigo-400"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          {saved ? <p className="text-xs text-emerald-800">{saved}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
