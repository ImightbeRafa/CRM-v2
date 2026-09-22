'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'

type ChannelRow = {
  id: string
  platform: string
  displayName: string | null
  displayPhoneNumber: string | null
  providerUsername: string | null
  attendedBy: string | null
  attendedByThisAgent: boolean
  aiAllowed: boolean
}

const HINT = 'text-[11px] text-slate-600'

export function ChannelsEditor({
  agentId,
  canEdit,
  onUseForTest,
  onChannels,
}: {
  agentId: string
  canEdit: boolean
  onUseForTest: (socialAccountId: string) => void
  onChannels?: (channels: ChannelRow[]) => void
}) {
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const onChannelsRef = useRef(onChannels)
  const requestRef = useRef(0)
  onChannelsRef.current = onChannels

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    const res = await fetch(`/api/chat/agents/${agentId}/bindings`)
    const data = await res.json()
    if (requestRef.current !== requestId) return
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los canales')
      onChannelsRef.current?.([])
      return
    }
    setSchemaReady(data.schemaReady !== false)
    const next: ChannelRow[] = data.channels || []
    setChannels(next)
    onChannelsRef.current?.(next)
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(row: ChannelRow, patch: { activeBinding?: boolean; aiAllowed?: boolean }) {
    if (!canEdit) return
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${agentId}/bindings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          socialAccountId: row.id,
          activeBinding: patch.activeBinding ?? row.attendedByThisAgent,
          aiAllowed: patch.aiAllowed ?? row.aiAllowed,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Error al guardar canal')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Canales</h2>
      <p className={`mt-0.5 ${HINT}`}>
        Elegí qué cuentas atiende este agente y dónde la IA está permitida. Lista vacía = no atiende a nadie.
      </p>
      {!schemaReady ? (
        <p className="mt-2 text-xs text-amber-800">Esquema pendiente (SQL 029).</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {channels.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No hay cuentas sociales en este tenant.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {channels.map((row) => {
            const label =
              row.displayName || row.providerUsername || row.displayPhoneNumber || row.platform
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {label}{' '}
                    <span className="text-xs font-normal text-slate-500">{row.platform}</span>
                  </p>
                  <p className={HINT}>
                    {row.attendedBy
                      ? `Atiende: ${row.attendedBy}`
                      : 'Sin agente asignado'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-800">
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={row.attendedByThisAgent}
                      disabled={!canEdit || busyId === row.id}
                      onChange={(e) => void save(row, { activeBinding: e.target.checked })}
                    />
                    Atiende
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={row.aiAllowed}
                      disabled={!canEdit || busyId === row.id}
                      onChange={(e) => void save(row, { aiAllowed: e.target.checked })}
                    />
                    IA permitida
                  </label>
                  <button
                    type="button"
                    className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-800 ring-1 ring-slate-200"
                    onClick={() => onUseForTest(row.id)}
                  >
                    Probar aquí
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
