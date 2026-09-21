'use client'

import React, { useState } from 'react'

type HistoryItem = { direction: 'inbound' | 'outbound'; content: string; sentAt: string }

type TurnResult = {
  text: string
  tokens?: { input: number; output: number; cached: number }
  latencyMs?: number
  wouldSend?: boolean
  blockedBy?: string[]
  highlightedAmounts?: number[]
  intent?: string
  shortcutKey?: string | null
  decisionTrace?: unknown
}

const FIELD =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 disabled:bg-slate-100'
const HINT = 'text-[11px] text-slate-600'

export function AgentTestSandbox({
  agentId,
  canEdit,
  socialAccountId,
}: {
  agentId: string
  canEdit: boolean
  socialAccountId: string | null
}) {
  const [sessionId] = useState(() => crypto.randomUUID())
  const [text, setText] = useState('¿Cómo puedo pagar?')
  const [messageType, setMessageType] = useState<'text' | 'image' | 'audio' | 'document' | 'video'>('text')
  const [windowOpen, setWindowOpen] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [last, setLast] = useState<TurnResult | null>(null)
  const [replay, setReplay] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function sendTurn() {
    if (!canEdit || !socialAccountId || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundText: text.trim(),
          socialAccountId,
          testSessionId: sessionId,
          messageType,
          history,
          windowOpen,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en Probar')
      const outbound = typeof data.text === 'string' ? data.text : ''
      const now = new Date().toISOString()
      setHistory((prev) =>
        [
          ...prev,
          { direction: 'inbound' as const, content: text.trim(), sentAt: now },
          ...(outbound
            ? [{ direction: 'outbound' as const, content: outbound, sentAt: now }]
            : []),
        ].slice(-40),
      )
      setLast(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  async function replayAll() {
    if (!canEdit) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/test/replay`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error en replay')
      setReplay(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusy(false)
    }
  }

  const rows = Array.isArray(replay?.rows) ? (replay.rows as Array<Record<string, unknown>>) : []

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-semibold text-slate-900">Probar conversación</h2>
      <p className={`mt-0.5 ${HINT}`}>
        Sandbox aislado: no escribe a Meta ni a un chat real. Elegí el canal con «Probar aquí».
      </p>
      <p className={`mt-1 ${HINT}`}>
        Canal: {socialAccountId || 'ninguno'} · sesión {sessionId.slice(0, 8)}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          className={FIELD}
          value={messageType}
          disabled={!canEdit || busy}
          onChange={(e) => setMessageType(e.target.value as typeof messageType)}
        >
          <option value="text">Texto</option>
          <option value="image">Imagen simulada</option>
          <option value="audio">Audio simulado</option>
          <option value="document">Documento simulado</option>
          <option value="video">Video simulado</option>
        </select>
        <label className="inline-flex items-center gap-1 text-xs text-slate-800">
          <input type="checkbox" checked={windowOpen} disabled={!canEdit} onChange={(e) => setWindowOpen(e.target.checked)} />
          Ventana de 24 h abierta
        </label>
      </div>
      <div className="mt-3 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-white p-2 ring-1 ring-slate-200">
        {history.length === 0 ? (
          <p className={HINT}>Todavía no hay turnos en esta sesión.</p>
        ) : (
          history.map((item, index) => (
            <p key={`${item.sentAt}-${index}`} className="text-sm text-slate-900">
              <span className="text-xs uppercase text-slate-500">{item.direction === 'inbound' ? 'Cliente' : 'Agente'}: </span>
              {item.content}
            </p>
          ))
        )}
      </div>
      <textarea
        className={`mt-2 w-full ${FIELD}`}
        rows={2}
        value={text}
        disabled={!canEdit || busy}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canEdit || busy || !socialAccountId}
          onClick={() => void sendTurn()}
          className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:bg-indigo-400"
        >
          {busy ? 'Probando…' : 'Enviar turno'}
        </button>
        <button
          type="button"
          disabled={!canEdit || busy}
          onClick={() => void replayAll()}
          className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200"
        >
          Replay todo
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {last ? (
        <div className="mt-3 space-y-2 text-sm text-slate-900">
          <p className="whitespace-pre-wrap rounded-lg bg-white p-3 ring-1 ring-slate-200">{last.text}</p>
          <p className={HINT}>
            intent {last.intent || '—'} · atajo {last.shortcutKey || '—'} · enviaría{' '}
            {last.wouldSend ? 'sí' : 'no'}
            {last.blockedBy?.length ? ` · bloqueado: ${last.blockedBy.join(', ')}` : ''}
          </p>
          {last.highlightedAmounts?.length ? (
            <p className="text-xs text-amber-900">Montos sin fuente: {last.highlightedAmounts.join(', ')}</p>
          ) : null}
          <pre className="max-h-40 overflow-auto rounded bg-white p-2 text-[11px] text-slate-700 ring-1 ring-slate-200">
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
    </div>
  )
}
