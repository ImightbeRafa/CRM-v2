'use client'

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FlaskConical, Plus } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import {
  AGENT_TOOL_NAMES,
  DEFAULT_CHAT_AGENT_MODEL,
  TONE_PRESET_LABELS,
  type ChatAgentTonePreset,
} from '@/lib/soft-ai/agent-types'
import { ConocimientoWizardInner } from '@/app/config/agentes/conocimiento/ConocimientoWizard'
import { AgentTestSandbox } from '@/app/config/agentes/AgentTestSandbox'
import { BrandFactsEditor } from '@/app/config/agentes/BrandFactsEditor'
import { ChannelsEditor, type ChannelRow } from '@/app/config/agentes/ChannelsEditor'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import {
  AuroraEmptyState,
  AuroraListSkeleton,
  auroraButtonPrimary,
  auroraButtonSecondary,
} from '@/components/aurora/states'
import { AuroraToggle } from '@/components/aurora/agentes/AuroraToggle'
import { AgentListPanel } from '@/components/aurora/agentes/AgentListPanel'
import {
  AgentModeChip,
  AgentNoChannelsChip,
  AgentStatusChip,
} from '@/components/aurora/agentes/AgentChips'
import { channelIdentity, summarizeBind } from '@/lib/agent-channel-bind'
import { ShortcutPasteImport } from '@/app/config/agentes/ShortcutPasteImport'
import { ShortcutsEditor } from '@/app/config/agentes/ShortcutsEditor'
import { selectWhatsappTestChannel, type TestChannelOption } from '@/lib/soft-ai/test-channel'

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

const CARD = 'rounded-2xl bg-white p-4 ring-1 ring-slate-200/70'
const PILL =
  'rounded-full bg-[#EEF0FF] px-2.5 py-0.5 text-[11px] font-medium text-[#4A5AE8] ring-1 ring-[#5B6CFF]/15'
const CHIP_SM = 'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1'

type AgentTab =
  | 'resumen'
  | 'personalidad'
  | 'canales'
  | 'conocimiento'
  | 'herramientas'
  | 'seguridad'
  | 'historial'

const AGENT_TABS: Array<{ key: AgentTab; label: string }> = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'personalidad', label: 'Personalidad' },
  { key: 'canales', label: 'Canales' },
  { key: 'conocimiento', label: 'Conocimiento' },
  { key: 'herramientas', label: 'Herramientas' },
  { key: 'seguridad', label: 'Seguridad' },
  { key: 'historial', label: 'Historial' },
]

const DEFAULT_KNOWLEDGE_CARDS: ChecklistCard[] = [
  {
    id: 'precios',
    title: 'Precios',
    statusLabel: 'Usar inventario en vivo',
    hint: 'search_inventory es la fuente de verdad.',
    inventoryWins: true,
  },
  { id: 'envios', title: 'Envíos', statusLabel: 'Sin fuentes', hint: 'Políticas de envío aprobadas.' },
  { id: 'ofertas', title: 'Ofertas', statusLabel: 'Sin fuentes', hint: 'FAQ / promos aprobadas.' },
  { id: 'politicas', title: 'Políticas', statusLabel: 'Sin fuentes', hint: 'Devoluciones y reglas.' },
]

function knowledgeChipClass(statusLabel: string): string {
  const tone =
    statusLabel.includes('aprobado') || statusLabel === 'Usar inventario en vivo'
      ? 'bg-emerald-50 text-emerald-800'
      : statusLabel.includes('borrador')
        ? 'bg-amber-50 text-amber-900'
        : 'bg-slate-100 text-slate-700'
  return `shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`
}

const TOOL_LABELS: Record<string, string> = {
  search_inventory: 'Buscar inventario (precios en vivo)',
  search_approved_knowledge: 'Buscar conocimiento aprobado',
  get_order_status: 'Estado de pedido',
  get_shipping_status: 'Estado de envío',
  escalate_to_human: 'Escalar a humano',
  use_shortcut: 'Usar atajo',
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

type AgentDeepLink = { agente: string | null; seccion: string | null; card: string | null }

/** Reads `?agente=&seccion=&card=` (own Suspense boundary: `useSearchParams` needs one at build). */
function AgentDeepLinkReader({ onChange }: { onChange: (link: AgentDeepLink) => void }) {
  const params = useSearchParams()
  const agente = params?.get('agente') ?? null
  const seccion = params?.get('seccion') ?? null
  const card = params?.get('card') ?? null
  useEffect(() => {
    onChange({ agente, seccion, card })
  }, [agente, seccion, card, onChange])
  return null
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
  const [channelId, setChannelId] = useState<string | null>(null)
  const [testChannels, setTestChannels] = useState<TestChannelOption[]>([])
  const [channelsLoaded, setChannelsLoaded] = useState(false)
  const [channelRows, setChannelRows] = useState<ChannelRow[]>([])
  const [tab, setTab] = useState<AgentTab>('resumen')
  const [setupRefresh, setSetupRefresh] = useState(0)
  const [channelReload, setChannelReload] = useState(0)
  const [history, setHistory] = useState<unknown[]>([])
  const [introDraft, setIntroDraft] = useState('')
  const [checklist, setChecklist] = useState<ChecklistCard[]>([])
  const [knowledgeSchemaReady, setKnowledgeSchemaReady] = useState(true)
  /** In-page conocimiento panel — avoids /config soft-nav remount flash. */
  const [knowledgePanel, setKnowledgePanel] = useState<{
    open: boolean
    cardId: string | null
  }>({ open: false, cardId: null })

  const selected = agents.find((a) => a.id === selectedId) || null
  const isEmpty = !loading && agents.length === 0
  const knowledgeCards = checklist.length ? checklist : DEFAULT_KNOWLEDGE_CARDS

  const openKnowledge = useCallback((cardId?: string | null) => {
    setKnowledgePanel({ open: true, cardId: cardId ?? null })
  }, [])

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

  const [deepLink, setDeepLink] = useState<AgentDeepLink>({ agente: null, seccion: null, card: null })
  const deepLinkRef = useRef(deepLink)
  deepLinkRef.current = deepLink
  const appliedDeepLink = useRef<string | null>(null)

  const closeKnowledge = useCallback(() => {
    setKnowledgePanel({ open: false, cardId: null })
    void load({ silent: true })
    // Drop `seccion` from the URL so a refresh doesn't reopen the wizard.
    if (deepLinkRef.current.seccion) {
      const agente = deepLinkRef.current.agente
      router.replace(`/config?tab=agentes${agente ? `&agente=${encodeURIComponent(agente)}` : ''}`, { scroll: false })
    }
  }, [load, router])

  useEffect(() => {
    void load()
  }, [load])

  // Deep link (?agente=<id>&seccion=conocimiento[&card=]): applied once per distinct link, after load.
  useEffect(() => {
    if (loading) return
    const key = JSON.stringify(deepLink)
    if (appliedDeepLink.current === key) return
    appliedDeepLink.current = key
    if (deepLink.agente && agents.some((a) => a.id === deepLink.agente)) setSelectedId(deepLink.agente)
    if (deepLink.seccion === 'conocimiento') openKnowledge(deepLink.card)
  }, [deepLink, loading, agents, openKnowledge])

  useEffect(() => {
    setChannelId(null)
    setTestChannels([])
    setChannelRows([])
    setChannelsLoaded(false)
  }, [selectedId])

  useEffect(() => {
    setChannelId((current) => selectWhatsappTestChannel(testChannels, current).selectedId)
  }, [testChannels])

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
      if (data.starterAgentId) setSelectedId(data.starterAgentId)
      else if (data.predId) setSelectedId(data.predId)
      await load({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function panic(action: string) {
    if (!selectedId || !canEdit || saving) return
    if (!window.confirm('¿Confirmás detener o limitar el agente en este canal?')) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${selectedId}/panic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          socialAccountId: channelId,
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

  const bindSummary = summarizeBind(channelRows)
  const attendingRows = channelRows.filter((r) => r.attendedByThisAgent)
  const hasBindData = channelsLoaded

  function goTab(next: AgentTab) {
    setTab(next)
  }

  function probar() {
    setTab('canales')
    setTimeout(() => {
      document.getElementById('agent-probar')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const canCreate = canEdit && schemaReady

  return (
    <AuroraShell>
      <Suspense fallback={null}>
        <AgentDeepLinkReader onChange={setDeepLink} />
      </Suspense>
      <header className="sticky top-0 z-20 flex flex-col gap-3 border-b border-slate-200/70 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold leading-tight text-slate-900">Agentes IA</h1>
          <p className="text-[12px] text-slate-500">
            Quién atiende cada línea, con qué voz y qué puede hacer
          </p>
        </div>
        {canEdit && !isEmpty && !knowledgePanel.open ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void bootstrapPilot()}
              disabled={saving || !schemaReady}
              className={`${auroraButtonSecondary} py-2.5 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {saving ? 'Guardando…' : 'Sembrar agentes iniciales'}
            </button>
            <button
              type="button"
              onClick={() => void createAgent()}
              disabled={saving || !schemaReady}
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#5B6CFF] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#4A5AE8] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {saving ? 'Guardando…' : 'Nuevo agente'}
            </button>
          </div>
        ) : null}
      </header>

      {knowledgePanel.open ? (
        <Suspense fallback={<div className="p-4 text-sm text-slate-600">Cargando…</div>}>
          <ConocimientoWizardInner
            key={knowledgePanel.cardId || 'wizard'}
            cardId={knowledgePanel.cardId}
            onBack={closeKnowledge}
          />
        </Suspense>
      ) : (
        <div className="mx-auto w-full max-w-[1200px] space-y-4 px-6 py-5 !text-slate-900 [color-scheme:light]">
          {!schemaReady ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
              SQL 027/027b/029 aún no aplicado — la UI es de solo lectura hasta el gated apply. No se
              pueden crear ni sembrar agentes.
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100"
            >
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-2xl bg-white ring-1 ring-slate-200/70">
              <AuroraListSkeleton rows={4} />
            </div>
          ) : isEmpty ? (
            <div className="rounded-2xl bg-white ring-1 ring-slate-200/70">
              <AuroraEmptyState
                icon="✨"
                title="Todavía no hay agentes"
                description={
                  !canEdit
                    ? 'Necesitás permiso de configuración para crear agentes.'
                    : !schemaReady
                      ? 'Aplicá SQL 027 + 027b + 029 para habilitar creación y siembra.'
                      : 'Sembrá los agentes iniciales (Predeterminado + Ventas) o creá uno nuevo para configurar voz, tono y herramientas.'
                }
                actions={
                  canCreate ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void bootstrapPilot()}
                        disabled={saving}
                        className={`${auroraButtonPrimary} disabled:opacity-50`}
                      >
                        {saving ? 'Sembrando…' : 'Sembrar agentes iniciales'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void createAgent()}
                        disabled={saving}
                        className={`${auroraButtonSecondary} disabled:opacity-50`}
                      >
                        {saving ? 'Creando…' : 'Nuevo agente'}
                      </button>
                    </>
                  ) : null
                }
              />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
              <AgentListPanel
                agents={agents}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onCreate={canCreate ? () => void createAgent() : undefined}
                createDisabled={saving}
                creating={saving}
              />

              <section className="min-w-0 rounded-2xl bg-white ring-1 ring-slate-200/70">
                {!selected ? (
                  <p className="p-5 text-sm text-slate-600">Seleccioná un agente en la lista.</p>
                ) : (
                  <>
                    {/* Detail header */}
                    <div className="rounded-t-2xl bg-gradient-to-r from-[#F3F1FF] to-white px-5 pt-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-2xl shadow-sm ring-1 ring-slate-200/70"
                            aria-hidden
                          >
                            {selected.emoji}
                          </span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="truncate text-[18px] font-semibold text-slate-900">
                                {selected.name}
                              </h2>
                              <AgentStatusChip status={selected.status} />
                              <AgentModeChip mode={selected.operationMode} />
                              {hasBindData && bindSummary.attendsNobody ? (
                                <AgentNoChannelsChip />
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[12px] text-slate-500">
                              {selected.description ? `${selected.description} · ` : ''}v
                              {selected.version}
                              {hasBindData
                                ? ` · ${bindSummary.attending} ${
                                    bindSummary.attending === 1 ? 'canal' : 'canales'
                                  }`
                                : ''}
                            </p>
                          </div>
                        </div>
                        <button type="button" onClick={probar} className={auroraButtonSecondary}>
                          <FlaskConical className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                          Probar agente
                        </button>
                      </div>
                      <div
                        role="tablist"
                        aria-label="Secciones del agente"
                        className="-mb-px mt-4 flex gap-5 overflow-x-auto"
                      >
                        {AGENT_TABS.map((t) => (
                          <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === t.key}
                            onClick={() => goTab(t.key)}
                            className={`whitespace-nowrap border-b-2 pb-2.5 text-[13px] font-medium transition-colors ${
                              tab === t.key
                                ? 'border-[#5B6CFF] text-[#5B6CFF]'
                                : 'border-transparent text-slate-500 hover:text-slate-800'
                            }`}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-slate-200/70" />

                    {/*
                      All tab panels stay mounted (toggled with `hidden`) so editors keep state
                      and switching tabs never remounts the page or re-fetches bindings.
                    */}
                    <div className="space-y-4 p-5">
                      {/* Resumen */}
                      <div hidden={tab !== 'resumen'} role="tabpanel" className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className={CARD}>
                            <div className="flex items-center justify-between">
                              <h3 className="text-[14px] font-semibold text-slate-900">
                                Personalidad y voz
                              </h3>
                              <button
                                type="button"
                                onClick={() => goTab('personalidad')}
                                className="text-[12px] font-medium text-[#5B6CFF]"
                              >
                                Editar
                              </button>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <span className={PILL}>
                                {TONE_PRESET_LABELS[selected.tonePreset as ChatAgentTonePreset] ??
                                  selected.tonePreset}
                              </span>
                              {(selected.introductionNames || []).map((n) => (
                                <span key={n} className={PILL}>
                                  {n}
                                </span>
                              ))}
                            </div>
                            <p className="mt-3 line-clamp-4 rounded-xl bg-[#F5F4FF] px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 ring-1 ring-[#5B6CFF]/10">
                              {selected.systemInstructions?.trim() || 'Sin instrucciones de voz todavía.'}
                            </p>
                          </div>

                          <div className={CARD}>
                            <div className="flex items-center justify-between">
                              <h3 className="text-[14px] font-semibold text-slate-900">Canales</h3>
                              <button
                                type="button"
                                onClick={() => goTab('canales')}
                                className="text-[12px] font-medium text-[#5B6CFF]"
                              >
                                {canEdit ? 'Elegir canales' : 'Ver canales'}
                              </button>
                            </div>
                            {!hasBindData ? (
                              <p className="mt-3 text-[12px] text-slate-500">Cargando canales…</p>
                            ) : attendingRows.length === 0 ? (
                              <p
                                className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100"
                                data-testid="resumen-attends-nobody"
                              >
                                No atiende a nadie: todavía no elegiste ningún número ni Instagram.
                              </p>
                            ) : (
                              <ul className="mt-3 space-y-2">
                                {attendingRows.map((r) => {
                                  const id = channelIdentity(r)
                                  return (
                                    <li key={r.id} className="flex items-center justify-between gap-2">
                                      <span className="min-w-0">
                                        <span className="block truncate text-[13px] font-medium text-slate-900">
                                          {id.title}
                                        </span>
                                        <span className="block text-[11px] text-slate-500">
                                          {id.platformLabel}
                                          {id.detail ? ` · ${id.detail}` : ''}
                                        </span>
                                      </span>
                                      <span
                                        className={`${CHIP_SM} ${
                                          r.aiAllowed
                                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                                            : 'bg-slate-100 text-slate-500 ring-slate-200'
                                        }`}
                                      >
                                        {r.aiAllowed ? 'IA permitida' : 'IA no permitida'}
                                      </span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </div>

                          <div className={CARD}>
                            <div className="flex items-center justify-between">
                              <h3 className="text-[14px] font-semibold text-slate-900">
                                Cobertura de conocimiento
                              </h3>
                              <button
                                type="button"
                                onClick={() => goTab('conocimiento')}
                                className="text-[12px] font-medium text-[#5B6CFF]"
                              >
                                Ver conocimiento
                              </button>
                            </div>
                            <ul className="mt-3 space-y-1.5">
                              {knowledgeCards.map((card) => (
                                <li
                                  key={card.id}
                                  className="flex items-center justify-between gap-2 text-[12px]"
                                >
                                  <span className="font-medium text-slate-800">{card.title}</span>
                                  <span className={knowledgeChipClass(card.statusLabel)}>
                                    {card.statusLabel}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className={CARD}>
                            <div className="flex items-center justify-between">
                              <h3 className="text-[14px] font-semibold text-slate-900">
                                Herramientas
                              </h3>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                {selected.enabledTools.filter((t) => AGENT_TOOL_NAMES.includes(t as never)).length}{' '}
                                de {AGENT_TOOL_NAMES.length}
                              </span>
                            </div>
                            <ul className="mt-3 space-y-1.5 text-[12px]">
                              {AGENT_TOOL_NAMES.map((tool) => {
                                const on = selected.enabledTools.includes(tool)
                                return (
                                  <li
                                    key={tool}
                                    className={on ? 'text-slate-800' : 'text-slate-400'}
                                  >
                                    {on ? '●' : '○'} {TOOL_LABELS[tool] || tool}
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        </div>

                        {/* Estado y modo */}
                        <div className={CARD}>
                          <h3 className="text-[14px] font-semibold text-slate-900">Estado y modo</h3>
                          <p className={`mt-0.5 ${HINT_CLASS}`}>
                            El modo y el estado se guardan al cambiarlos. El envío real sigue
                            bloqueado hasta aprobar cada canal.
                          </p>
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
                      </div>

                      {/* Personalidad */}
                      <div hidden={tab !== 'personalidad'} role="tabpanel" className="space-y-4">
                        <ShortcutPasteImport
                          agentId={selected.id}
                          canEdit={canEdit}
                          onApplied={() => setSetupRefresh((value) => value + 1)}
                        />

                        {/* Identidad */}
                        <div className={CARD}>
                          <div className="mb-3 flex items-baseline justify-between gap-2">
                            <h3 className="text-[14px] font-semibold text-slate-900">Identidad</h3>
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
                              Ana). El primero es el preferido.
                            </p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              {(selected.introductionNames || []).map((n) => (
                                <span
                                  key={n}
                                  className="inline-flex items-center gap-1 rounded-full bg-[#EEF0FF] px-2.5 py-1 text-sm font-medium text-[#4A5AE8] ring-1 ring-[#5B6CFF]/15"
                                >
                                  {n}
                                  {canEdit ? (
                                    <button
                                      type="button"
                                      disabled={saving}
                                      className="ml-0.5 text-[#5B6CFF] hover:text-[#4A5AE8] disabled:opacity-50"
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
                                    className={`${auroraButtonSecondary} disabled:opacity-50`}
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
                                  className={`rounded-full px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${
                                    selected.tonePreset === t
                                      ? 'bg-[#5B6CFF] text-white'
                                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  {TONE_PRESET_LABELS[t]}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Voz */}
                        <div className={CARD}>
                          <h3 className="text-[14px] font-semibold text-slate-900">Voz</h3>
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
                            No puede anular: dinero → humano, no inventar precios, no decir
                            &quot;ya creé&quot;.
                          </p>
                        </div>

                        <BrandFactsEditor
                          agentId={selected.id}
                          canEdit={canEdit}
                          reloadToken={setupRefresh}
                        />
                        <ShortcutsEditor
                          agentId={selected.id}
                          canEdit={canEdit}
                          reloadToken={setupRefresh}
                        />
                      </div>

                      {/* Canales (bind por SocialAccount) + Probar */}
                      <div hidden={tab !== 'canales'} role="tabpanel" className="space-y-4">
                        <ChannelsEditor
                          agentId={selected.id}
                          canEdit={canEdit}
                          reloadToken={channelReload}
                          onUseForTest={setChannelId}
                          onChannels={(rows) => {
                            setChannelRows(rows)
                            setTestChannels(
                              rows.map((row) => {
                                const id = channelIdentity(row)
                                return {
                                  id: row.id,
                                  platform: row.platform,
                                  attendedByThisAgent: row.attendedByThisAgent,
                                  label: id.detail ? `${id.title} · ${id.detail}` : id.title,
                                }
                              }),
                            )
                            setChannelsLoaded(true)
                          }}
                        />
                        <div id="agent-probar">
                          <AgentTestSandbox
                            agentId={selected.id}
                            agentName={selected.name}
                            canEdit={canEdit}
                            channels={testChannels}
                            channelsLoaded={channelsLoaded}
                            socialAccountId={channelId}
                            onSelectChannel={setChannelId}
                            onUnlocked={() => setChannelReload((value) => value + 1)}
                          />
                        </div>
                      </div>

                      {/* Conocimiento A2 — live checklist + wizard */}
                      <div hidden={tab !== 'conocimiento'} role="tabpanel" className="space-y-4">
                        <div className={CARD}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h3 className="text-[14px] font-semibold text-slate-900">
                                Conocimiento
                              </h3>
                              <p className={`mt-0.5 ${HINT_CLASS}`}>
                                Pegá y aprobá Brand Book / políticas / FAQ. Precios: inventario en
                                vivo manda.
                                {!knowledgeSchemaReady ? ' SQL 028 aún no aplicado.' : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => openKnowledge(null)}
                              className={auroraButtonPrimary}
                            >
                              Abrir wizard
                            </button>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {knowledgeCards.map((card) => (
                              <button
                                key={card.id}
                                type="button"
                                onClick={() => openKnowledge(card.id)}
                                className="rounded-xl bg-white px-3 py-2.5 text-left text-slate-900 ring-1 ring-slate-200 hover:ring-[#5B6CFF]/40"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-slate-900">{card.title}</p>
                                  <span className={knowledgeChipClass(card.statusLabel)}>
                                    {card.statusLabel}
                                  </span>
                                </div>
                                <p className={`mt-1 leading-snug ${HINT_CLASS}`}>{card.hint}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Herramientas */}
                      <div hidden={tab !== 'herramientas'} role="tabpanel" className="space-y-4">
                        <div className={CARD}>
                          <h3 className="text-[14px] font-semibold text-slate-900">Herramientas</h3>
                          <ul className="mt-3 divide-y divide-slate-100">
                            {AGENT_TOOL_NAMES.map((tool) => (
                              <li key={tool} className="flex items-center justify-between gap-3 py-2.5">
                                <span className="text-[13px] font-medium text-slate-900">
                                  {TOOL_LABELS[tool] || tool}
                                </span>
                                <AuroraToggle
                                  checked={selected.enabledTools.includes(tool)}
                                  disabled={!canEdit || saving}
                                  label={TOOL_LABELS[tool] || tool}
                                  onChange={(on) => {
                                    const next = on
                                      ? [...selected.enabledTools, tool]
                                      : selected.enabledTools.filter((t) => t !== tool)
                                    void patch({ enabledTools: next })
                                  }}
                                />
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      {/* Seguridad */}
                      <div hidden={tab !== 'seguridad'} role="tabpanel" className="space-y-4">
                        <div className={CARD}>
                          <h3 className="text-[14px] font-semibold text-slate-900">Detener agente</h3>
                          <p className={`mt-0.5 ${HINT_CLASS}`}>
                            Pausá el canal, pasá a solo humanos, o sacalo de la lista.
                            {channelId
                              ? ' Aplica al canal elegido en Probar.'
                              : ' Elegí un canal en Canales → Probar para acotarlo.'}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!canEdit || saving}
                              onClick={() => void panic('pause_channel')}
                              className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 ring-1 ring-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Pausar canal
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit || saving}
                              onClick={() => void panic('human_only')}
                              className="rounded-lg bg-orange-50 px-3 py-2 text-xs font-medium text-orange-950 ring-1 ring-orange-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Solo humanos
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit || saving}
                              onClick={() => void panic('remove_allowlist')}
                              className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-950 ring-1 ring-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              Quitar de la lista
                            </button>
                          </div>
                        </div>

                        {/* Avanzado — audited model migration (existing PATCH). */}
                        <details className={CARD}>
                          <summary className="cursor-pointer text-[14px] font-semibold text-slate-900">
                            Avanzado
                          </summary>
                          <p className="mt-3 text-sm text-slate-900">
                            Modelo: <span className="font-mono">{selected.model}</span>
                          </p>
                          {canEdit && selected.model !== DEFAULT_CHAT_AGENT_MODEL ? (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void patch({ model: DEFAULT_CHAT_AGENT_MODEL })}
                              className={`mt-3 ${auroraButtonSecondary} disabled:opacity-50`}
                            >
                              Cambiar a {DEFAULT_CHAT_AGENT_MODEL}
                            </button>
                          ) : null}
                        </details>
                      </div>

                      {/* Historial */}
                      <div hidden={tab !== 'historial'} role="tabpanel" className="space-y-4">
                        <div className={CARD}>
                          <h3 className="text-[14px] font-semibold text-slate-900">
                            Cambios recientes
                          </h3>
                          {history.length === 0 ? (
                            <p className="mt-2 text-[12px] text-slate-500">
                              Todavía no hay cambios registrados.
                            </p>
                          ) : (
                            <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto text-xs text-slate-700">
                              {history.map((h, i) => {
                                const row = h as {
                                  id?: string
                                  timestamp?: string
                                  userName?: string
                                  reason?: string
                                }
                                return (
                                  <li key={row.id || i} className="rounded-lg bg-slate-50 px-2.5 py-1.5">
                                    {row.timestamp} · {row.userName} · {row.reason || 'update'}
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </AuroraShell>
  )
}
