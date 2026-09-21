'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { hasSessionPermission } from '@/lib/session-permissions'
import {
  A1_TOOL_NAMES,
  FORGE_WA_SOCIAL_ACCOUNT_ID,
  TONE_PRESET_LABELS,
  type ChatAgentTonePreset,
} from '@/lib/soft-ai/agent-types'

type AgentRow = {
  id: string
  name: string
  emoji: string
  description: string | null
  systemInstructions: string
  tonePreset: string
  model: string
  operationMode: string
  enabledTools: string[]
  status: string
  version: number
  bindings?: Array<{
    id: string
    scope: string
    socialAccountId: string | null
    isActive: boolean
  }>
}

const TONES: ChatAgentTonePreset[] = ['warm_concise', 'formal', 'playful']

export default function AgentesConfigPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const canEdit = hasSessionPermission(session, 'update_config')

  const [agents, setAgents] = useState<AgentRow[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testText, setTestText] = useState('¿Tienen el kit en stock?')
  const [testResult, setTestResult] = useState<{
    text: string
    tokens: { input: number; output: number; cached: number }
    latencyMs: number
    toolTrace: unknown
  } | null>(null)
  const [history, setHistory] = useState<unknown[]>([])

  const selected = agents.find((a) => a.id === selectedId) || null

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/agents')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setSchemaReady(data.schemaReady !== false)
      setAgents(data.agents || [])
      if (!selectedId && data.agents?.[0]?.id) setSelectedId(data.agents[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedId) return
    void (async () => {
      const res = await fetch(`/api/chat/agents/${selectedId}`)
      if (!res.ok) return
      const data = await res.json()
      setHistory(data.history || [])
    })()
  }, [selectedId])

  async function patch(patch: Record<string, unknown>) {
    if (!selectedId || !canEdit) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function createAgent() {
    if (!canEdit) return
    setSaving(true)
    try {
      const res = await fetch('/api/chat/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Agente ${agents.length + 1}` }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setSelectedId(data.agent.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function bootstrapPilot() {
    if (!canEdit) return
    setSaving(true)
    try {
      await fetch('/api/chat/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapPilot: true }),
      })
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function runProbar() {
    if (!selectedId || !canEdit) return
    setSaving(true)
    setTestResult(null)
    try {
      const res = await fetch(`/api/chat/agents/${selectedId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inboundText: testText,
          socialAccountId: FORGE_WA_SOCIAL_ACCOUNT_ID,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error en Probar')
      setTestResult({
        text: data.text,
        tokens: data.tokens,
        latencyMs: data.latencyMs,
        toolTrace: data.toolTrace,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function panic(action: string) {
    if (!selectedId || !canEdit) return
    if (!window.confirm('¿Confirmás esta acción de pánico?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/chat/agents/${selectedId}/panic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          socialAccountId: FORGE_WA_SOCIAL_ACCOUNT_ID,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <button
          type="button"
          onClick={() => router.push('/config')}
          className="mb-4 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Configuración
        </button>

        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
              <Sparkles className="h-6 w-6 text-indigo-600" /> Agentes de chat
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Voz, tono, herramientas y canales del Soft Agent Layer (piloto Forge WA).
            </p>
          </div>
          {canEdit ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void bootstrapPilot()}
                disabled={saving}
                className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
              >
                Sembrar piloto
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Nuevo agente
              </button>
            </div>
          ) : null}
        </header>

        {!schemaReady ? (
          <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
            SQL 027 aún no aplicado — la UI es de solo lectura hasta el gated apply.
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <aside className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
              <ul className="space-y-1">
                {agents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                        selectedId === a.id ? 'bg-indigo-50 text-indigo-900' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span>{a.emoji}</span>
                      <span className="truncate font-medium">{a.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <section className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
              {!selected ? (
                <p className="text-sm text-slate-500">Seleccioná un agente.</p>
              ) : (
                <div className="space-y-5">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Nombre</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      defaultValue={selected.name}
                      key={`name-${selected.id}-${selected.version}`}
                      disabled={!canEdit}
                      onBlur={(e) => void patch({ name: e.target.value })}
                    />
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-500">Tono</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {TONES.map((t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={!canEdit}
                          onClick={() => void patch({ tonePreset: t })}
                          className={`rounded-full px-3 py-1 text-xs font-medium ${
                            selected.tonePreset === t
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {TONE_PRESET_LABELS[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-500">Voz del agente</label>
                    <textarea
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      rows={4}
                      maxLength={1200}
                      defaultValue={selected.systemInstructions}
                      key={`voz-${selected.id}-${selected.version}`}
                      disabled={!canEdit}
                      onBlur={(e) => void patch({ systemInstructions: e.target.value })}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      No puede anular: dinero → humano, no inventar precios, no decir &quot;ya
                      creé&quot;.
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-slate-500">Herramientas</p>
                    <div className="mt-2 space-y-1">
                      {A1_TOOL_NAMES.map((tool) => (
                        <label key={tool} className="flex items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={selected.enabledTools.includes(tool)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...selected.enabledTools, tool]
                                : selected.enabledTools.filter((t) => t !== tool)
                              void patch({ enabledTools: next })
                            }}
                          />
                          {tool}
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">Modo</p>
                      <select
                        className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={selected.operationMode}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const mode = e.target.value
                          if (
                            mode === 'ai_full' &&
                            !window.confirm(
                              'Responder (ai_full) queda en Sugerir hasta pasar la prueba dark-run. ¿Continuar?',
                            )
                          ) {
                            return
                          }
                          void patch({ operationMode: mode })
                        }}
                      >
                        <option value="ai_suggest">Sugerir</option>
                        <option value="ai_full">Responder</option>
                        <option value="human_only">Solo humanos</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-500">Estado</p>
                      <select
                        className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={selected.status}
                        disabled={!canEdit}
                        onChange={(e) => {
                          if (
                            e.target.value === 'live' &&
                            !window.confirm('¿Pasar a En vivo? Solo agentes En vivo corren en inbound real.')
                          ) {
                            return
                          }
                          void patch({ status: e.target.value })
                        }}
                      >
                        <option value="draft">Borrador</option>
                        <option value="live">En vivo</option>
                        <option value="archived">Archivado</option>
                      </select>
                    </div>
                    <p className="self-end text-xs text-slate-400">v{selected.version}</p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-4">
                    <p className="text-sm font-medium text-slate-800">Probar</p>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      rows={2}
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      disabled={!canEdit}
                    />
                    <button
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => void runProbar()}
                      className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Probar (sin Meta)
                    </button>
                    {testResult ? (
                      <div className="mt-3 space-y-2 text-sm">
                        <p className="whitespace-pre-wrap rounded-lg bg-white p-3 ring-1 ring-slate-100">
                          {testResult.text}
                        </p>
                        <p className="text-xs text-slate-500">
                          Tokens in {testResult.tokens.input} / out {testResult.tokens.output} /
                          cached {testResult.tokens.cached} · {testResult.latencyMs} ms
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-800">Controles de pánico</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => void panic('pause_channel')}
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-100 disabled:opacity-50"
                      >
                        Pausar canal
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => void panic('human_only')}
                        className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 ring-1 ring-orange-100 disabled:opacity-50"
                      >
                        Solo humanos
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => void panic('remove_allowlist')}
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-900 ring-1 ring-red-100 disabled:opacity-50"
                      >
                        Quitar de la lista
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-800">Historial (últimos 20)</p>
                    <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-xs text-slate-600">
                      {history.map((h, i) => {
                        const row = h as {
                          id?: string
                          timestamp?: string
                          userName?: string
                          reason?: string
                        }
                        return (
                          <li key={row.id || i} className="rounded bg-slate-50 px-2 py-1">
                            {row.timestamp} · {row.userName} · {row.reason || 'update'}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
