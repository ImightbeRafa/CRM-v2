'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { formatRealSendStatus, type RealSendStatus } from '@/lib/soft-ai/agent-config'
import type { AiFullUnlockMismatch } from '@/lib/soft-ai/agent-types'
import type { LineAiStatus } from '@/lib/soft-ai/agent-status'
import { Instagram, MessageCircle } from 'lucide-react'
import { AuroraToggle } from '@/components/aurora/agentes/AuroraToggle'
import { channelIdentity } from '@/lib/agent-channel-bind'

export type ChannelLineRun = {
  id: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cost_capped' | 'canceled' | 'error'
  done: number
  total: number
  quick: boolean
  cases: Array<{ id: string; title: string; group: string }>
  results: Array<{ id: string; title: string; pass: boolean; reply: string; notes: string[]; error?: string | null }>
}

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
  /** Agentes IA 2.0: the line truth for this agent (GET /lines). */
  ai?: LineAiStatus | null
  run?: ChannelLineRun | null
}

const HINT = 'text-[11px] text-slate-500'

/**
 * A channel can look "on" (agent En vivo + Responder, attends it, AI allowed) and still stay quiet: real replies need
 * a green "Probar y activar" for this agent version. Say it plainly instead of a grey hint (Rafael 2026-10-14).
 */
export function unactivatedChannelCopy(realSend: RealSendStatus): string {
  return realSend === 'stale'
    ? 'Este canal NO responde todavía: el agente cambió desde la última activación. Corré «Probar y activar» otra vez.'
    : 'Este canal NO responde todavía: falta «Probar y activar» para este canal. Hasta entonces los mensajes quedan para una persona.'
}

/** Agent page "Estado y modo": say plainly when En vivo + Responder still answers nobody (no channel activated). */
export function liveWithoutActivationNotice(input: {
  status: string
  operationMode: string
  rows: Array<Pick<ChannelRow, 'aiAllowed' | 'realSend'>>
}): string | null {
  if (input.status !== 'live' || input.operationMode !== 'ai_full') return null
  if (input.rows.length === 0) return 'En vivo, pero no atiende ninguna línea: elegí una en «Líneas» y después corré «Probar y activar».'
  const off = input.rows.filter((r) => !r.aiAllowed || (r.realSend || 'locked') !== 'unlocked').length
  if (off === 0) return null
  return off === input.rows.length
    ? 'En vivo, pero todavía NO responde en ninguna línea: falta «Probar y activar» (botón Probar arriba). Hasta entonces los chats quedan para una persona.'
    : `${off} de ${input.rows.length} líneas todavía no responden: falta «Probar y activar» en esas líneas.`
}

/** Pure: is the switch "on" (the owner wants the line answered)? Checking and problems count as on; the pill says why. */
export function lineSwitchOn(ai: Pick<LineAiStatus, 'state'> | null | undefined): boolean {
  if (!ai) return false
  return ai.state === 'on' || ai.state === 'checking' || ai.state === 'problem'
}

const PILL: Record<LineAiStatus['state'], string> = {
  on: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  checking: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  problem: 'bg-amber-50 text-amber-900 ring-amber-200',
  off: 'bg-slate-100 text-slate-600 ring-slate-200',
}

/**
 * Agentes IA 2.0 "Líneas": ONE switch per line + the truth pill and its single fix. While the 6-case check runs it
 * shows "Probando… n de 6"; a failed check lists the failed cases with "Ver respuesta". "Revisar todo" opens the
 * full suite (Probar). Plain words only (no allowlist / unlock / binding).
 */
export function ChannelsEditor({
  agentId,
  canEdit,
  reloadToken = 0,
  onUseForTest,
  onChannels,
  agentAnswers = false,
}: {
  agentId: string
  canEdit: boolean
  reloadToken?: number
  onUseForTest: (socialAccountId: string) => void
  onChannels?: (channels: ChannelRow[]) => void
  /** Agent is En vivo + Responder: only then is a not-activated channel a surprise (Solo humanos / Borrador are on purpose). */
  agentAnswers?: boolean
}) {
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [openAnswer, setOpenAnswer] = useState<string | null>(null)
  const onChannelsRef = useRef(onChannels)
  const requestRef = useRef(0)
  onChannelsRef.current = onChannels

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/lines`, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (requestRef.current !== requestId) return
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar las líneas')
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

  // While a line is being checked, follow "Probando… n de 6" until it turns on (or says what failed).
  const checking = channels.some((c) => c.ai?.state === 'checking')
  useEffect(() => {
    if (!checking) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [checking, load])

  async function power(row: ChannelRow, on: boolean, takeOver = false) {
    if (!canEdit) return
    setBusyId(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/lines/${encodeURIComponent(row.id)}/power`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on, takeOver }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'No se pudo cambiar la línea')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setBusyId(null)
      await load()
    }
  }

  const answering = channels.filter((c) => c.ai?.state === 'on').length

  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70" data-testid="agent-channels">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold text-slate-900">Líneas</h2>
          <p className={`mt-0.5 ${HINT}`}>
            Un interruptor por número de WhatsApp o Instagram. Al encender, Betsy prueba al agente con 6 preguntas y, si
            pasa, la IA empieza a responder y contesta los chats que quedaron esperando.
          </p>
        </div>
        {channels.length > 0 ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {answering} de {channels.length} con IA
          </span>
        ) : null}
      </div>
      {!schemaReady ? <p className="mt-2 text-xs text-amber-800">Esquema pendiente (SQL 029).</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      {channels.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">
          No hay líneas conectadas. Conectá un número de WhatsApp o Instagram en Cuentas conectadas.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {channels.map((row) => {
            const identity = channelIdentity(row)
            const Icon = identity.platformLabel === 'Instagram' ? Instagram : MessageCircle
            const iconCls = identity.platformLabel === 'Instagram' ? 'bg-pink-50 text-pink-600' : 'bg-emerald-50 text-emerald-600'
            const busy = busyId === row.id
            const ai = row.ai ?? null
            const on = lineSwitchOn(ai)
            const otherAgent = ai?.code === 'OTHER_AGENT'
            const failed = ai?.code === 'CHECK_FAILED' && row.run ? row.run.results.filter((r) => !r.pass) : []
            return (
              <li key={row.id} className="py-3" data-testid="agent-line">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconCls}`} aria-hidden>
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-[160px] flex-1">
                    <p className="text-[13px] font-medium text-slate-900">{identity.title}</p>
                    <p className={HINT}>
                      {identity.platformLabel}
                      {identity.detail ? ` · ${identity.detail}` : ''}
                    </p>
                    {ai ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${PILL[ai.state]}`} data-testid="agent-line-status">
                          {ai.label}
                        </span>
                        <span className={HINT}>{ai.hint}</span>
                      </div>
                    ) : (
                      <p className={HINT}>
                        {formatRealSendStatus({
                          realSend: row.realSend || 'locked',
                          realSendReason: row.realSendReason ?? null,
                          versionWarning: Boolean(row.realSendVersionWarning),
                          approvedVersion: row.approvedVersion ?? null,
                        })}
                      </p>
                    )}
                    {/* Fallback when the line truth is unavailable: keep the plain warning. */}
                    {!ai && agentAnswers && row.attendedByThisAgent && row.aiAllowed && (row.realSend || 'locked') !== 'unlocked' ? (
                      <p role="status" className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] text-amber-800 ring-1 ring-amber-200">
                        {unactivatedChannelCopy(row.realSend || 'locked')}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[12px] text-slate-700">
                    {otherAgent ? (
                      canEdit ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void power(row, true, true)}
                          className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Pasar a este agente y encender
                        </button>
                      ) : null
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {on ? 'Encendida' : 'Apagada'}
                        <AuroraToggle
                          checked={on}
                          disabled={!canEdit || busy || !ai}
                          label={`IA en ${identity.title}`}
                          onChange={(next) => void power(row, next)}
                        />
                      </span>
                    )}
                    {ai?.state === 'problem' && canEdit ? (
                      // Most fixes end with "volvé a encender": one click re-runs the check (the switch stays on).
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void power(row, true)}
                        className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50"
                      >
                        Volver a encender
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded-lg bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                      onClick={() => onUseForTest(row.id)}
                    >
                      Revisar todo
                    </button>
                  </div>
                </div>
                {failed.length ? (
                  <ul className="ml-12 mt-2 space-y-1" data-testid="agent-line-failed">
                    {failed.map((r) => {
                      const key = `${row.id}:${r.id}`
                      return (
                        <li key={r.id} className="text-[12px]">
                          <span className="text-red-800">✗ {r.title}</span>{' '}
                          <button
                            type="button"
                            className="font-medium text-au-ink-5b6cff hover:underline"
                            onClick={() => setOpenAnswer(openAnswer === key ? null : key)}
                          >
                            Ver respuesta
                          </button>
                          {openAnswer === key ? (
                            <div className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-700">
                              <p className="whitespace-pre-wrap">{r.reply || '(pasó el chat a una persona)'}</p>
                              {r.notes.length ? <p className="mt-1 text-red-800">{r.notes.join(' ')}</p> : null}
                              {r.error ? <p className="mt-1 text-red-800">No se pudo correr esta prueba.</p> : null}
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
