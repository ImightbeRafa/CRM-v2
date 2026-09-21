'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { hasSessionPermission } from '@/lib/session-permissions'
import {
  AGENT_TOOL_NAMES,
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
  introductionNames: string[]
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

/** Light-surface form controls: explicit foreground so dark theme cannot inherit pale text. */
const FIELD_CLASS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:!text-slate-600'
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-base leading-relaxed !text-slate-900 placeholder:!text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:!text-slate-600'
const SELECT_CLASS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:!text-slate-600'
const META_CLASS = 'text-[11px] text-slate-600'
const HINT_CLASS = 'text-[11px] text-slate-600'

const TOOL_LABELS: Record<string, string> = {
  search_inventory: 'Buscar inventario (precios en vivo)',
  search_approved_knowledge: 'Buscar conocimiento aprobado',
  get_order_status: 'Estado de pedido',
  get_shipping_status: 'Estado de envío',
  escalate_to_human: 'Escalar a humano',
}

type ChecklistCard = {
  id: string
  title: string
  statusLabel: string
  hint: string
  inventoryWins?: boolean
}

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
  const [introDraft, setIntroDraft] = useState('')
  const [checklist, setChecklist] = useState<ChecklistCard[]>([])
  const [knowledgeSchemaReady, setKnowledgeSchemaReady] = useState(true)

  const selected = agents.find((a) => a.id === selectedId) || null
  const isEmpty = !loading && agents.length === 0

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const [res, kRes] = await Promise.all([
        fetch('/api/chat/agents'),
        fetch('/api/chat/knowledge?checklist=1'),
      ])
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al cargar agentes'))
      setSchemaReady(data.schemaReady !== false)
      const nextAgents: AgentRow[] = data.agents || []
      setAgents(nextAgents)
      setSelectedId((prev) => {
        if (prev && nextAgents.some((a) => a.id === prev)) return prev
        return nextAgents[0]?.id ?? null
      })
      if (kRes.ok) {
        const kData = await kRes.json()
        setKnowledgeSchemaReady(kData.schemaReady !== false)
        setChecklist(
          (kData.cards || []).map(
            (c: {
              id: string
              title: string
              statusLabel: string
              hint: string
              inventoryWins?: boolean
            }) => ({
              id: c.id,
              title: c.title,
              statusLabel: c.statusLabel,
              hint: c.hint,
              inventoryWins: c.inventoryWins,
            }),
          ),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      if (!opts?.silent) setLoading(false)
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
      await load({ silent: true })
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
      await load({ silent: true })
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
      await load({ silent: true })
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
      await load({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 !text-slate-900 [color-scheme:light]">
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
                className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
              >
                {saving ? 'Guardando…' : 'Sembrar piloto Forge'}
              </button>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={saving || !schemaReady}
                className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400 disabled:text-white"
              >
                {saving ? 'Guardando…' : 'Crear agente'}
              </button>
            </div>
          ) : null}
        </header>

        {!schemaReady ? (
          <div className="mb-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
            SQL 027/027b aún no aplicado — la UI es de solo lectura hasta el gated apply. No se pueden
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
          <p className="text-sm text-slate-600">Cargando…</p>
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
                  className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400 disabled:text-white"
                >
                  {saving ? 'Sembrando…' : 'Sembrar piloto Forge'}
                </button>
                <button
                  type="button"
                  onClick={() => void createAgent()}
                  disabled={saving}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                >
                  {saving ? 'Creando…' : 'Crear agente'}
                </button>
              </div>
            ) : null}
            {canEdit && !schemaReady ? (
              <p className="mt-4 text-xs text-amber-800">
                Aplicá SQL 027 + 027b para habilitar creación y siembra.
              </p>
            ) : null}
            {!canEdit ? (
              <p className="mt-4 text-xs text-slate-600">
                Necesitás permiso de configuración para crear agentes.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <aside className="rounded-xl bg-white p-2 ring-1 ring-slate-100">
              <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-slate-600">
                Agentes
              </p>
              <ul className="space-y-0.5">
                {agents.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                        selectedId === a.id
                          ? 'bg-indigo-50 text-indigo-900'
                          : 'text-slate-800 hover:bg-slate-50'
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
                <p className="text-sm text-slate-600">Seleccioná un agente en la lista.</p>
              ) : (
                <div className="space-y-5">
                  {/* Identidad */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-3 flex items-baseline justify-between gap-2">
                      <h2 className="text-sm font-semibold text-slate-900">Identidad</h2>
                      <span className={META_CLASS}>v{selected.version}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                      <div>
                        <label className="text-xs font-medium text-slate-700">Nombre interno</label>
                        <input
                          className={`mt-1 w-full ${FIELD_CLASS}`}
                          defaultValue={selected.name}
                          key={`name-${selected.id}-${selected.version}`}
                          disabled={!canEdit || saving}
                          onBlur={(e) => void patch({ name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-700">Emoji</label>
                        <input
                          className={`mt-1 w-20 text-center ${FIELD_CLASS}`}
                          defaultValue={selected.emoji}
                          key={`emoji-${selected.id}-${selected.version}`}
                          disabled={!canEdit || saving}
                          onBlur={(e) => void patch({ emoji: e.target.value })}
                          maxLength={8}
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="text-xs font-medium text-slate-700">
                        Nombres de presentación
                      </label>
                      <p className={`mt-0.5 ${HINT_CLASS}`}>
                        1–3 nombres con los que el agente se presenta en chats nuevos (ej. Sofía,
                        Forge). El primero es el preferido.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {(selected.introductionNames || []).map((n) => (
                          <span
                            key={n}
                            className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-sm font-medium text-indigo-900 ring-1 ring-indigo-100"
                          >
                            {n}
                            {canEdit ? (
                              <button
                                type="button"
                                disabled={saving}
                                className="ml-0.5 text-indigo-700 hover:text-indigo-900 disabled:text-indigo-400"
                                aria-label={`Quitar ${n}`}
                                onClick={() => {
                                  const next = (selected.introductionNames || []).filter(
                                    (x) => x !== n,
                                  )
                                  void patch({ introductionNames: next })
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </span>
                        ))}
                        {(selected.introductionNames || []).length < 3 && canEdit ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault()
                              const value = introDraft.trim()
                              if (!value) return
                              const next = [...(selected.introductionNames || []), value]
                              setIntroDraft('')
                              void patch({ introductionNames: next })
                            }}
                          >
                            <input
                              className={`w-36 ${FIELD_CLASS} px-2.5 py-1.5`}
                              placeholder="Agregar nombre"
                              value={introDraft}
                              disabled={saving}
                              maxLength={40}
                              onChange={(e) => setIntroDraft(e.target.value)}
                            />
                            <button
                              type="submit"
                              disabled={saving || !introDraft.trim()}
                              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 ring-1 ring-slate-200 hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-600"
                            >
                              Añadir
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className="text-xs font-medium text-slate-700">Tono</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {TONES.map((t) => (
                          <button
                            key={t}
                            type="button"
                            disabled={!canEdit || saving}
                            onClick={() => void patch({ tonePreset: t })}
                            className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed ${
                              selected.tonePreset === t
                                ? 'bg-indigo-600 text-white disabled:bg-indigo-400'
                                : 'bg-white text-slate-800 ring-1 ring-slate-200 disabled:bg-slate-100 disabled:text-slate-600'
                            }`}
                          >
                            {TONE_PRESET_LABELS[t]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Voz */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Voz</h2>
                    <p className={`mt-0.5 ${HINT_CLASS}`}>
                      Instrucciones editables. Nunca anulan las reglas fijas de seguridad.
                    </p>
                    <textarea
                      className={`mt-3 ${TEXTAREA_CLASS}`}
                      rows={8}
                      maxLength={1200}
                      defaultValue={selected.systemInstructions}
                      key={`voz-${selected.id}-${selected.version}`}
                      disabled={!canEdit || saving}
                      onBlur={(e) => void patch({ systemInstructions: e.target.value })}
                    />
                    <p className={`mt-1.5 ${META_CLASS}`}>
                      No puede anular: dinero → humano, no inventar precios, no decir &quot;ya
                      creé&quot;.
                    </p>
                  </div>

                  {/* Herramientas */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Herramientas</h2>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {AGENT_TOOL_NAMES.map((tool) => (
                        <label
                          key={tool}
                          className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-900"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            disabled={!canEdit || saving}
                            checked={selected.enabledTools.includes(tool)}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...selected.enabledTools, tool]
                                : selected.enabledTools.filter((t) => t !== tool)
                              void patch({ enabledTools: next })
                            }}
                          />
                          <span>
                            <span className="font-medium text-slate-900">
                              {TOOL_LABELS[tool] || tool}
                            </span>
                            <span className={`mt-0.5 block ${META_CLASS}`}>{tool}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Modo */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Modo</h2>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-700">Operación</p>
                        <select
                          className={`mt-1 ${SELECT_CLASS}`}
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
                        <p className="text-xs font-medium text-slate-700">Estado</p>
                        <select
                          className={`mt-1 ${SELECT_CLASS}`}
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
                    </div>
                  </div>

                  {/* Conocimiento A2 — live checklist + wizard */}
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-900">Conocimiento</h2>
                        <p className={`mt-0.5 ${HINT_CLASS}`}>
                          Pegá y aprobá Brand Book / políticas / FAQ. Precios: inventario en vivo
                          manda.
                          {!knowledgeSchemaReady
                            ? ' SQL 028 aún no aplicado.'
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => router.push('/config/agentes/conocimiento')}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Abrir wizard
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {(checklist.length
                        ? checklist
                        : [
                            {
                              id: 'precios',
                              title: 'Precios',
                              statusLabel: 'Usar inventario en vivo',
                              hint: 'search_inventory es la fuente de verdad.',
                              inventoryWins: true,
                            },
                            {
                              id: 'envios',
                              title: 'Envíos',
                              statusLabel: 'Sin fuentes',
                              hint: 'Políticas de envío aprobadas.',
                            },
                            {
                              id: 'ofertas',
                              title: 'Ofertas',
                              statusLabel: 'Sin fuentes',
                              hint: 'FAQ / promos aprobadas.',
                            },
                            {
                              id: 'politicas',
                              title: 'Políticas',
                              statusLabel: 'Sin fuentes',
                              hint: 'Devoluciones y reglas.',
                            },
                          ]
                      ).map((card) => (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() =>
                            router.push(`/config/agentes/conocimiento?card=${card.id}`)
                          }
                          className="rounded-lg bg-white px-3 py-2.5 text-left text-slate-900 ring-1 ring-indigo-100 hover:ring-indigo-300"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900">{card.title}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                card.statusLabel.includes('aprobado') ||
                                card.statusLabel === 'Usar inventario en vivo'
                                  ? 'bg-emerald-50 text-emerald-800'
                                  : card.statusLabel.includes('borrador')
                                    ? 'bg-amber-50 text-amber-900'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {card.statusLabel}
                            </span>
                          </div>
                          <p className={`mt-1 leading-snug ${HINT_CLASS}`}>{card.hint}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Probar */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Probar</h2>
                    <p className={`mt-0.5 ${HINT_CLASS}`}>
                      Corre un turno de prueba sin enviar a Meta.
                    </p>
                    <textarea
                      className={`mt-3 ${TEXTAREA_CLASS} py-2 text-sm`}
                      rows={2}
                      value={testText}
                      onChange={(e) => setTestText(e.target.value)}
                      disabled={!canEdit || saving}
                      placeholder="Escribí un mensaje de prueba…"
                    />
                    <button
                      type="button"
                      disabled={!canEdit || saving}
                      onClick={() => void runProbar()}
                      className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-indigo-400 disabled:text-white"
                    >
                      {saving ? 'Probando…' : 'Probar (sin Meta)'}
                    </button>
                    {testResult ? (
                      <div className="mt-3 space-y-2 text-sm text-slate-900">
                        <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm !text-slate-900 ring-1 ring-slate-200">
                          {testResult.text}
                        </p>
                        <p className="text-xs text-slate-600">
                          Tokens in {testResult.tokens.input} / out {testResult.tokens.output} /
                          cached {testResult.tokens.cached} · {testResult.latencyMs} ms
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {/* Pánico */}
                  <div className="rounded-xl border border-red-100 bg-red-50/40 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Pánico</h2>
                    <p className={`mt-0.5 ${HINT_CLASS}`}>
                      Controles de emergencia para el piloto Forge WA.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('pause_channel')}
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 ring-1 ring-amber-200 disabled:cursor-not-allowed disabled:bg-amber-50/70 disabled:text-amber-800"
                      >
                        Pausar canal
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('human_only')}
                        className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-950 ring-1 ring-orange-200 disabled:cursor-not-allowed disabled:bg-orange-50/70 disabled:text-orange-800"
                      >
                        Solo humanos
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('remove_allowlist')}
                        className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-950 ring-1 ring-red-200 disabled:cursor-not-allowed disabled:bg-red-50/70 disabled:text-red-800"
                      >
                        Quitar de la lista
                      </button>
                    </div>
                  </div>

                  {/* Historial */}
                  <div className="rounded-xl border border-slate-200 p-4">
                    <h2 className="text-sm font-semibold text-slate-900">Historial (últimos 20)</h2>
                    <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto text-xs text-slate-700">
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
