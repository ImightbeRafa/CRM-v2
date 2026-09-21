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

function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
  }
  return fallback
}

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
  const isEmpty = !loading && agents.length === 0

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/agents')
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al cargar agentes'))
      setSchemaReady(data.schemaReady !== false)
      const nextAgents: AgentRow[] = data.agents || []
      setAgents(nextAgents)
      setSelectedId((prev) => {
        if (prev && nextAgents.some((a) => a.id === prev)) return prev
        return nextAgents[0]?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setHistory([])
      return
    }
    void (async () => {
      const res = await fetch(`/api/chat/agents/${selectedId}`)
      if (!res.ok) return
      const data = await res.json()
      setHistory(data.history || [])
    })()
  }, [selectedId])

  async function patch(patch: Record<string, unknown>) {
    if (!selectedId || !canEdit || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al guardar'))
      if (data.schemaReady === false) setSchemaReady(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function createAgent() {
    if (!canEdit || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Agente ${agents.length + 1}` }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al crear agente'))
      if (data.schemaReady === false) setSchemaReady(false)
      if (data.agent?.id) setSelectedId(data.agent.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function bootstrapPilot() {
    if (!canEdit || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bootstrapPilot: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al sembrar piloto'))
      if (data.schemaReady === false) setSchemaReady(false)
      if (data.forgeId) setSelectedId(data.forgeId)
      else if (data.predId) setSelectedId(data.predId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function runProbar() {
    if (!selectedId || !canEdit || saving) return
    setSaving(true)
    setError(null)
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
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error en Probar'))
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
    if (!selectedId || !canEdit || saving) return
    if (!window.confirm('¿Confirmás esta acción de pánico?')) return
    setSaving(true)
    setError(null)
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
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error en control de pánico'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="mx-auto max-w-5xl px-4 py-4 md:px-6 md:py-5">
        <button
          type="button"
          onClick={() => router.push('/config')}
          className="mb-3 inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Configuración
        </button>

        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900 md:text-2xl">
              <Sparkles className="h-5 w-5 text-indigo-600 md:h-6 md:w-6" /> Agentes de chat
            </h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Voz, tono, herramientas y canales del Soft Agent Layer (piloto Forge WA).
            </p>
          </div>
          {canEdit && !isEmpty ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void bootstrapPilot()}
                disabled={saving || !schemaReady}
                className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Sembrar piloto Forge'}
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={saving || !schemaReady}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Crear agente'}
              </button>
            </div>
          ) : null}
        </header>

        {!schemaReady ? (
          <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
            SQL 027 aún no aplicado — la UI es de solo lectura hasta el gated apply. No se pueden
            crear ni sembrar agentes.
          </div>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100"
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : isEmpty ? (
          <div className="rounded-xl bg-white px-6 py-10 text-center ring-1 ring-slate-100">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-2xl">
              ✨
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Todavía no hay agentes</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Sembrá el piloto Forge (Predeterminado + Forge ventas) o creá un agente nuevo para
              configurar voz, tono y herramientas.
            </p>
            {canEdit && schemaReady ? (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void bootstrapPilot()}
                  disabled={saving}
                  className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Sembrando…' : 'Sembrar piloto Forge'}
                </button>
                <button
                  type="button"
                  onClick={() => void createAgent()}
                  disabled={saving}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Creando…' : 'Crear agente'}
                </button>
              </div>
            ) : null}
            {canEdit && !schemaReady ? (
              <p className="mt-4 text-xs text-amber-800">
                Aplicá SQL 027 para habilitar creación y siembra.
              </p>
            ) : null}
            {!canEdit ? (
              <p className="mt-4 text-xs text-slate-500">
                Necesitás permiso de configuración para crear agentes.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <aside className="rounded-xl bg-white p-2 ring-1 ring-slate-100">
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Agentes
              </p>
              <ul className="space-y-0.5">
                {agents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
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

            <section className="rounded-xl bg-white p-4 ring-1 ring-slate-100 md:p-5">
              {!selected ? (
                <p className="text-sm text-slate-500">Seleccioná un agente en la lista.</p>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Nombre</label>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                      defaultValue={selected.name}
                      key={`name-${selected.id}-${selected.version}`}
                      disabled={!canEdit || saving}
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
                          disabled={!canEdit || saving}
                          onClick={() => void patch({ tonePreset: t })}
                          className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-50 ${
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
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                      rows={4}
                      maxLength={1200}
                      defaultValue={selected.systemInstructions}
                      key={`voz-${selected.id}-${selected.version}`}
                      disabled={!canEdit || saving}
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
                            disabled={!canEdit || saving}
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
                        className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                        value={selected.operationMode}
                        disabled={!canEdit || saving}
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
                        className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                        value={selected.status}
                        disabled={!canEdit || saving}
                        onChange={(e) => {
                          if (
                            e.target.value === 'live' &&
                            !window.confirm(
                              '¿Pasar a En vivo? Solo agentes En vivo corren en inbound real.',
                            )
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

                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-800">Probar</p>
                    <textarea
                      className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:opacity-60"
                      rows={2}
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      disabled={!canEdit || saving}
                    />
                    <button
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => void runProbar()}
                      className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {saving ? 'Probando…' : 'Probar (sin Meta)'}
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
                        disabled={!canEdit || saving}
                        onClick={() => void panic('pause_channel')}
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-100 disabled:opacity-50"
                      >
                        Pausar canal
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('human_only')}
                        className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 ring-1 ring-orange-100 disabled:opacity-50"
                      >
                        Solo humanos
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('remove_allowlist')}
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-900 ring-1 ring-red-100 disabled:opacity-50"
                      >
                        Quitar de la lista
                      </button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-800">Historial (últimos 20)</p>
                    <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs text-slate-600">
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
