'use client'

import React from 'react'

type TurnResult = {
  text: string
  wouldSend?: boolean
  blockedBy?: string[]
  highlightedAmounts?: number[]
  intent?: string
  shortcutKey?: string | null
  decisionTrace?: unknown
}

const FIELD =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 disabled:bg-slate-100 disabled:!text-slate-600'
const HINT = 'text-[11px] text-slate-600'

export function AgentInternalTests({
  canEdit,
  busy,
  messageType,
  windowOpen,
  last,
  replay,
  onMessageType,
  onWindowOpen,
  onReplay,
}: {
  canEdit: boolean
  busy: boolean
  messageType: 'text' | 'image' | 'audio' | 'document' | 'video'
  windowOpen: boolean
  last: TurnResult | null
  replay: Record<string, unknown> | null
  onMessageType: (value: 'text' | 'image' | 'audio' | 'document' | 'video') => void
  onWindowOpen: (value: boolean) => void
  onReplay: () => void
}) {
  const rows = Array.isArray(replay?.rows) ? (replay.rows as Array<Record<string, unknown>>) : []

  return (
    <details className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <summary className="cursor-pointer text-sm font-medium text-slate-900">Pruebas internas</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          className={FIELD}
          value={messageType}
          disabled={!canEdit || busy}
          onChange={(e) => onMessageType(e.target.value as typeof messageType)}
        >
          <option value="text">Texto</option>
          <option value="image">Imagen simulada</option>
          <option value="audio">Audio simulado</option>
          <option value="document">Documento simulado</option>
          <option value="video">Video simulado</option>
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-slate-800">
          <input
            type="checkbox"
            checked={windowOpen}
            disabled={!canEdit}
            onChange={(e) => onWindowOpen(e.target.checked)}
          />
          Ventana de 24 h abierta
        </label>
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={onReplay}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200"
        >
          Replay todo
        </button>
      </div>
      {last ? (
        <div className="mt-3 space-y-2 text-sm text-slate-900">
          <p className={HINT}>
            intent {last.intent || '—'} · atajo {last.shortcutKey || '—'} · enviaría{' '}
            {last.wouldSend ? 'sí' : 'no'}
            {last.blockedBy?.length ? ` · bloqueado: ${last.blockedBy.join(', ')}` : ''}
          </p>
          {last.highlightedAmounts?.length ? (
            <p className="text-xs text-amber-900">Montos sin fuente: {last.highlightedAmounts.join(', ')}</p>
          ) : null}
          <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-800 ring-1 ring-slate-200">
            {JSON.stringify(last.decisionTrace, null, 2)}
          </pre>
        </div>
      ) : null}
      {replay ? (
        <div className="mt-3">
          <p className={HINT}>
            passRate {String(replay.passRate)} · violaciones {String(replay.policyViolations)} · hash{' '}
            {String(replay.fixtureSetHash)} · tokens de prueba {String(replay.testTokensUsed)} /{' '}
            {String(replay.testDailyTokenCap)}
          </p>
          <div className="mt-2 max-h-48 overflow-auto rounded bg-white ring-1 ring-slate-200">
            <table className="w-full text-left text-[11px] text-slate-800">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-2 py-1">Id</th>
                  <th className="px-2 py-1">Esperado</th>
                  <th className="px-2 py-1">Real</th>
                  <th className="px-2 py-1">OK</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)} className="border-b border-slate-50">
                    <td className="px-2 py-1">{String(row.id)}</td>
                    <td className="px-2 py-1">{row.expectedHandoff ? 'handoff' : 'sigue'}</td>
                    <td className="px-2 py-1">{row.actualHandoff ? 'handoff' : 'sigue'}</td>
                    <td className="px-2 py-1">{row.pass ? 'sí' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </details>
  )
}
