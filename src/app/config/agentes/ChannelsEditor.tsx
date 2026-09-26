'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { formatRealSendStatus, type RealSendStatus } from '@/lib/soft-ai/agent-config'
import type { AiFullUnlockMismatch } from '@/lib/soft-ai/agent-types'
import { Instagram, MessageCircle } from 'lucide-react'
import { AuroraToggle } from '@/components/aurora/agentes/AuroraToggle'
import { channelIdentity, summarizeBind } from '@/lib/agent-channel-bind'

export type ChannelRow = {
  id: string
  platform: string
  displayName: string | null
  displayPhoneNumber: string | null
  providerUsername: string | null
  attendedBy: string | null
  attendedByThisAgent: boolean
  aiAllowed: boolean
  realSend?: RealSendStatus
  realSendReason?: AiFullUnlockMismatch | null
  realSendVersionWarning?: boolean
  approvedVersion?: number | null
}

const HINT = 'text-[11px] text-slate-500'

export function ChannelsEditor({
  agentId,
  canEdit,
  reloadToken = 0,
  onUseForTest,
  onChannels,
}: {
  agentId: string
  canEdit: boolean
  reloadToken?: number
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
  }, [load, reloadToken])

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

  const bind = summarizeBind(channels)

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70" data-testid="agent-channels">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Canales</h2>
          <p className={`mt-0.5 ${HINT}`}>
            Cada número de WhatsApp y cada Instagram se activa por separado. Lista vacía = el agente
            no atiende a nadie.
          </p>
        </div>
        {channels.length > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {bind.attending} de {bind.total} atendidos
          </span>
        ) : null}
      </div>
      {!schemaReady ? (
        <p className="mt-2 text-xs text-amber-800">Esquema pendiente (SQL 029).</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {channels.length > 0 && bind.attendsNobody ? (
        <p
          className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100"
          data-testid="agent-attends-nobody"
        >
          Este agente no atiende ningún canal todavía. Activá «Atiende» en los números que querés
          que use.
        </p>
      ) : null}
      {channels.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No hay canales conectados. Conectá un número de WhatsApp o Instagram en Canales.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {channels.map((row) => {
            const identity = channelIdentity(row)
            const Icon = identity.platformLabel === 'Instagram' ? Instagram : MessageCircle
            const iconCls =
              identity.platformLabel === 'Instagram'
                ? 'bg-pink-50 text-pink-600'
                : 'bg-emerald-50 text-emerald-600'
            const busy = busyId === row.id
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconCls}`}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-[160px] flex-1">
                  <p className="text-[13px] font-medium text-slate-900">{identity.title}</p>
                  <p className={HINT}>
                    {identity.platformLabel}
                    {identity.detail ? ` · ${identity.detail}` : ''}
                  </p>
                  <p className={HINT}>
                    {row.attendedBy
                      ? row.attendedByThisAgent
                        ? 'Atiende este agente'
                        : `Atiende: ${row.attendedBy}`
                      : 'Sin agente asignado'}
                    {' · '}
                    {formatRealSendStatus({
                      realSend: row.realSend || 'locked',
                      realSendReason: row.realSendReason ?? null,
                      versionWarning: Boolean(row.realSendVersionWarning),
                      approvedVersion: row.approvedVersion ?? null,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[12px] text-slate-700">
                  <span className="inline-flex items-center gap-2">
                    Atiende
                    <AuroraToggle
                      checked={row.attendedByThisAgent}
                      disabled={!canEdit || busy}
                      label={`Atiende ${identity.title}`}
                      onChange={(next) => void save(row, { activeBinding: next })}
                    />
                  </span>
                  <span className="inline-flex items-center gap-2">
                    IA permitida
                    <AuroraToggle
                      checked={row.aiAllowed}
                      disabled={!canEdit || busy}
                      label={`IA permitida en ${identity.title}`}
                      onChange={(next) => void save(row, { aiAllowed: next })}
                    />
                  </span>
                  <button
                    type="button"
                    className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
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
