'use client'

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import {
  AGENT_TOOL_NAMES,
  DEFAULT_CHAT_AGENT_MODEL,
  LUNA_CHAT_AGENT_MODEL,
  modelLabel,
  TONE_PRESET_LABELS,
  type ChatAgentTonePreset,
} from '@/lib/soft-ai/agent-types'
import { AgentTestSandbox } from '@/app/config/agentes/AgentTestSandbox'
import { AgentUsageCard } from '@/app/config/agentes/AgentUsageCard'
import { AiTermsCard } from '@/app/config/agentes/AiTermsCard'
import { AgentQualityCard } from '@/app/config/agentes/AgentQualityCard'
import { AgentInventoryCard } from '@/app/config/agentes/AgentInventoryCard'
import { AgentDisclosureToggle } from '@/app/config/agentes/AgentDisclosureToggle'
import { AgentPromoCard } from '@/app/config/agentes/AgentPromoCard'
import { AgentBusinessCard } from '@/app/config/agentes/AgentBusinessCard'
import { BrandFactsEditor } from '@/app/config/agentes/BrandFactsEditor'
import { ChannelsEditor, type ChannelRow } from '@/app/config/agentes/ChannelsEditor'
import { AuroraShell } from '@/components/aurora/AuroraShell'
import { useConfigTrail } from '@/components/aurora/config/ConfigShell'
import {
  AuroraEmptyState,
  AuroraErrorState,
  AuroraListSkeleton,
  auroraButtonPrimary,
  auroraButtonSecondary,
} from '@/components/aurora/states'
import { AuroraToggle } from '@/components/aurora/agentes/AuroraToggle'
import { AgentListPanel } from '@/components/aurora/agentes/AgentListPanel'
import { AgentDetailHeader } from '@/components/aurora/agentes/AgentDetailHeader'
import { AgentKnowledgeTab } from '@/components/aurora/agentes/AgentKnowledgeTab'
import {
  EMPTY_NEW_AGENT,
  NewAgentForm,
  parseIntroductionNames,
  type NewAgentDraft,
} from '@/components/aurora/agentes/NewAgentForm'
import {
  DRAFT_ENABLED_TABS,
  AGENT_SECTIONS,
  agentTabLabel,
  buildAgentHref,
  normalizeSeccion,
  resolveAgentParam,
  type AgentTab,
} from '@/components/aurora/agentes/agent-url'
import type { KnowledgeCard } from '@/components/aurora/agentes/knowledge-format'
import { channelIdentity, summarizeBind } from '@/lib/agent-channel-bind'
import { ShortcutPasteImport } from '@/app/config/agentes/ShortcutPasteImport'
import { ShortcutsEditor } from '@/app/config/agentes/ShortcutsEditor'
import { selectWhatsappTestChannel, type TestChannelOption } from '@/lib/soft-ai/test-channel'
import { StudioFlow } from '@/components/aurora/agentes/studio/StudioFlow'

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

const CARD = 'rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5'
const PILL =
  'rounded-full bg-au-tint-eef0ff px-2.5 py-0.5 text-[11px] font-medium text-au-ink-4a5ae8 ring-1 ring-[#5B6CFF]/15'
const CHIP_SM = 'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1'

const DEFAULT_KNOWLEDGE_CARDS: KnowledgeCard[] = [
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

function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err
  }
  return fallback
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type AgentDeepLink = {
  tabParam: string | null
  agente: string | null
  seccion: string | null
  card: string | null
}

/** Reads `?tab=&agente=&seccion=&card=` (own Suspense boundary: `useSearchParams` needs one at build). */
function AgentDeepLinkReader({ onChange }: { onChange: (link: AgentDeepLink) => void }) {
  const params = useSearchParams()
  const tabParam = params?.get('tab') ?? null
  const agente = params?.get('agente') ?? null
  const seccion = params?.get('seccion') ?? null
  const card = params?.get('card') ?? null
  useEffect(() => {
    onChange({ tabParam, agente, seccion, card })
  }, [tabParam, agente, seccion, card, onChange])
  return null
}

type View = 'list' | 'detail'

export default function AgentesConfigPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { setTrail } = useConfigTrail()
  const canEdit = hasSessionPermission(session, 'update_config')

  const [agents, setAgents] = useState<AgentRow[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [configuredModels, setConfiguredModels] = useState<string[] | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<View>('list')
  const [draftMode, setDraftMode] = useState(false)
  const [newDraft, setNewDraft] = useState<NewAgentDraft>(EMPTY_NEW_AGENT)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishNote, setPublishNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [channelId, setChannelId] = useState<string | null>(null)
  const [testChannels, setTestChannels] = useState<TestChannelOption[]>([])
  const [channelsLoaded, setChannelsLoaded] = useState(false)
  const [channelRows, setChannelRows] = useState<ChannelRow[]>([])
  const [tab, setTab] = useState<AgentTab>('resumen')
  const [cardId, setCardId] = useState<string | null>(null)
  const [setupRefresh, setSetupRefresh] = useState(0)
  const [channelReload, setChannelReload] = useState(0)
  // Bumped when Studio applies a draft: products it added must show in step ② (the version doesn't always change).
  const [studioApplied, setStudioApplied] = useState(0)
  const [history, setHistory] = useState<unknown[]>([])
  const [introDraft, setIntroDraft] = useState('')
  const [checklist, setChecklist] = useState<KnowledgeCard[]>([])
  const [knowledgeSchemaReady, setKnowledgeSchemaReady] = useState(true)
  const savingRef = useRef(false)

  const selected = agents.find((a) => a.id === selectedId) || null
  const isEmpty = !loading && agents.length === 0
  // Load failure (vs action errors): shown as an error state, never as "no agents yet".
  const [loadFailed, setLoadFailed] = useState(false)
  const knowledgeCards = checklist.length ? checklist : DEFAULT_KNOWLEDGE_CARDS
  const detailVisible = view === 'detail' && !draftMode && selected !== null

  const load = useCallback(async (opts?: { silent?: boolean }): Promise<AgentRow[] | null> => {
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
      if (Array.isArray(data.configuredModels)) setConfiguredModels(data.configuredModels as string[])
      const nextAgents: AgentRow[] = data.agents || []
      setAgents(nextAgents)
      setLoadFailed(false)
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
              approvedCount?: number
              draftCount?: number
            }) => ({
              id: c.id,
              title: c.title,
              statusLabel: c.statusLabel,
              hint: c.hint,
              inventoryWins: c.inventoryWins,
              approvedCount: c.approvedCount,
              draftCount: c.draftCount,
            }),
          ),
        )
      }
      return nextAgents
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
      setLoadFailed(true)
      return null
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  const [deepLink, setDeepLink] = useState<AgentDeepLink>({
    tabParam: null,
    agente: null,
    seccion: null,
    card: null,
  })
  const appliedDeepLink = useRef<string | null>(null)
  /** Id just created: the URL may point at it one render before `agents` contains it. */
  const pendingAgentId = useRef<string | null>(null)
  // Keep-alive: this panel stays mounted (hidden) on other Config tabs. It may only touch the URL
  // while it is the visible one, so it never hijacks navigation elsewhere.
  const isActivePanel = deepLink.tabParam === 'agentes'

  useEffect(() => {
    void load()
  }, [load])

  const replaceUrl = useCallback(
    (href: string) => {
      if (isActivePanel) router.replace(href, { scroll: false })
    },
    [isActivePanel, router],
  )

  // URL → state (applied once per distinct link, after load, only while visible).
  useEffect(() => {
    if (!isActivePanel) {
      appliedDeepLink.current = null
      return
    }
    if (loading) return
    const { agente, seccion, card } = deepLink
    const key = JSON.stringify([agente, seccion, card, agents.length])
    if (appliedDeepLink.current === key) return

    if (agente) {
      const res = resolveAgentParam(agente, agents)
      if (res.kind === 'none' && pendingAgentId.current === agente) return
      appliedDeepLink.current = key
      if (res.kind === 'id') {
        pendingAgentId.current = null
        setSelectedId(res.id)
        setView('detail')
        setDraftMode(false)
        setTab(normalizeSeccion(seccion))
        setCardId(card)
        return
      }
      if (res.kind === 'slug') {
        router.replace(
          buildAgentHref({ agente: res.id, seccion: seccion ? normalizeSeccion(seccion) : null, card }),
          { scroll: false },
        )
        return
      }
      // Ambiguous / unknown: fall back to the selected (or first) agent, keeping `seccion`.
      const fallback = agents.find((a) => a.id === selectedId) ?? agents[0]
      if (!fallback) {
        setView('list')
        return
      }
      setNotice('No encontramos ese agente; te mostramos otro.')
      router.replace(
        buildAgentHref({ agente: fallback.id, seccion: seccion ? normalizeSeccion(seccion) : null, card }),
        { scroll: false },
      )
      return
    }

    appliedDeepLink.current = key
    if (seccion) {
      // `/config/agentes/conocimiento` (PR-H redirect): open that section on the selected / first agent.
      const target = agents.find((a) => a.id === selectedId) ?? agents[0]
      if (target) {
        router.replace(buildAgentHref({ agente: target.id, seccion: normalizeSeccion(seccion), card }), {
          scroll: false,
        })
      } else {
        setView('list')
      }
      return
    }
    setView('list')
    setDraftMode(false)
  }, [deepLink, loading, agents, selectedId, isActivePanel, router])

  useEffect(() => {
    setChannelId(null)
    setTestChannels([])
    setChannelRows([])
    setChannelsLoaded(false)
    setPublishNote(null)
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

  // Breadcrumb: Configuración › Agentes IA › <agente> › <pestaña> (only while this panel is visible).
  useEffect(() => {
    if (!isActivePanel) return
    if (draftMode) setTrail(['Nuevo agente', agentTabLabel(tab)])
    else if (view === 'detail' && selected) setTrail([selected.name, agentTabLabel(tab)])
    else setTrail([])
    return () => setTrail([])
  }, [isActivePanel, draftMode, view, selected, tab, setTrail])

  async function patch(patch: Record<string, unknown>) {
    if (!selectedId || !canEdit || saving) return
    setSaving(true)
    savingRef.current = true
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
      savingRef.current = false
      setSaving(false)
    }
  }

  /**
   * "Publicar cambios": every field already saves on blur (PATCH + version bump) and status has
   * its own select. This only flushes the focused field, waits for the in-flight save and reloads.
   * It never changes status, so the runtime stays exactly as configured.
   */
  async function publishChanges() {
    if (!selectedId || publishing) return
    setPublishing(true)
    setPublishNote(null)
    try {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      await sleep(60)
      for (let i = 0; i < 50 && savingRef.current; i += 1) await sleep(100)
      const fresh = await load({ silent: true })
      const version = fresh?.find((a) => a.id === selectedId)?.version
      if (fresh) setPublishNote(version ? `Cambios guardados · v${version}` : 'Cambios guardados')
    } finally {
      setPublishing(false)
    }
  }

  function startDraft() {
    if (!canEdit || !schemaReady) return
    setNewDraft(EMPTY_NEW_AGENT)
    setNotice(null)
    setError(null)
    setDraftMode(true)
    setView('detail')
    setTab('resumen')
  }

  /** Create through the existing POST; lands on `&agente=<newId>&seccion=resumen`. */
  async function saveNewAgent() {
    if (!canEdit || saving) return
    if (!newDraft.name.trim()) {
      setError('Poné un nombre al agente para guardarlo.')
      setTab('resumen')
      return
    }
    setSaving(true)
    savingRef.current = true
    setError(null)
    try {
      const res = await fetch('/api/chat/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newDraft.name.trim(),
          emoji: newDraft.emoji.trim() || undefined,
          description: newDraft.description.trim() || null,
          tonePreset: newDraft.tonePreset,
          introductionNames: parseIntroductionNames(newDraft.introductionNames),
          systemInstructions: newDraft.systemInstructions || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al crear agente'))
      if (data.schemaReady === false) setSchemaReady(false)
      const newId: string | undefined = data.agent?.id
      pendingAgentId.current = newId ?? null
      await load({ silent: true })
      if (newId) {
        setDraftMode(false)
        setSelectedId(newId)
        setView('detail')
        setTab('resumen')
        setNewDraft(EMPTY_NEW_AGENT)
        replaceUrl(buildAgentHref({ agente: newId, seccion: 'resumen' }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      savingRef.current = false
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
      if (!res.ok) throw new Error(apiErrorMessage(data, 'Error al sembrar agentes'))
      if (data.schemaReady === false) setSchemaReady(false)
      await load({ silent: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function panic(action: string) {
    if (!selectedId || !canEdit || saving) return
    if (!await auroraConfirm('¿Confirmás detener o limitar el agente en este canal?')) return
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

  /** User action → state + URL (URL write only while this panel is the visible one). */
  function goTab(next: AgentTab, nextCard: string | null = cardId) {
    setNotice(null)
    setTab(next)
    if (draftMode || !selectedId) return
    replaceUrl(buildAgentHref({ agente: selectedId, seccion: next, card: next === 'conocimiento' ? nextCard : null }))
  }

  function openAgent(id: string, next: AgentTab = 'resumen') {
    setNotice(null)
    setSelectedId(id)
    setView('detail')
    setDraftMode(false)
    setTab(next)
    replaceUrl(buildAgentHref({ agente: id, seccion: next }))
  }

  function backToList() {
    setNotice(null)
    setDraftMode(false)
    setView('list')
    replaceUrl(buildAgentHref())
  }

  function selectKnowledgeCard(id: string | null) {
    setCardId(id)
    if (selectedId && !draftMode) replaceUrl(buildAgentHref({ agente: selectedId, seccion: 'conocimiento', card: id }))
  }

  async function scrollToProbar() {
    for (let i = 0; i < 15; i += 1) {
      const el = document.getElementById('agent-probar')
      // Only once its tab panel is visible (a hidden element cannot be scrolled to).
      if (el && el.offsetParent !== null) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        return
      }
      await sleep(100)
    }
  }

  function probar(id: string | null = selectedId) {
    if (!id) return
    if (id === selectedId && view === 'detail' && !draftMode) goTab('resumen')
    else openAgent(id, 'resumen')
    void scrollToProbar()
  }

  const canCreate = canEdit && schemaReady
  const inDetail = view === 'detail' && !isEmpty
  const detailLinesSubtitle = !hasBindData
    ? 'Cargando líneas…'
    : attendingRows.length === 0
      ? 'No atiende a ninguna línea'
      : attendingRows.map((r) => channelIdentity(r).title).join(' · ')
  const disabledDraftTabs = AGENT_SECTIONS.map((s) => s.key).filter((k) => !DRAFT_ENABLED_TABS.includes(k))

  return (
    <AuroraShell>
      <Suspense fallback={null}>
        <AgentDeepLinkReader onChange={setDeepLink} />
      </Suspense>

      {draftMode ? (
        <div className="border-b border-slate-200/70 bg-white px-4 pt-5 md:px-6">
          <AgentDetailHeader
            emoji={newDraft.emoji}
            name={newDraft.name.trim() || 'Nuevo agente'}
            status="draft"
            subtitle="Guardá el agente para elegir qué líneas atiende"
            tab={tab}
            onTab={(next) => {
              if (DRAFT_ENABLED_TABS.includes(next)) setTab(next)
            }}
            disabledTabs={disabledDraftTabs}
            onBack={backToList}
            onPublish={() => void saveNewAgent()}
            publishLabel="Guardar agente"
            publishing={saving}
            publishDisabled={!canEdit}
          />
        </div>
      ) : inDetail && selected ? (
        <div className="border-b border-slate-200/70 bg-white px-4 pt-5 md:px-6">
          <AgentDetailHeader
            emoji={selected.emoji}
            name={selected.name}
            status={selected.status}
            mode={selected.operationMode}
            subtitle={detailLinesSubtitle}
            tab={tab}
            onTab={(next) => goTab(next)}
            onBack={backToList}
            onProbar={() => probar(selected.id)}
            onPublish={() => void publishChanges()}
            publishing={publishing}
            publishDisabled={!canEdit}
            publishNote={publishNote}
          />
        </div>
      ) : (
        <header className="flex flex-col gap-3 border-b border-slate-200/70 bg-white px-4 py-4 md:px-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight text-slate-900">Agentes IA</h1>
            <p className="text-[12px] text-slate-500">
              Quién atiende cada línea, con qué voz y qué puede hacer
            </p>
          </div>
          {canEdit && !isEmpty ? (
            <div className="flex flex-wrap items-center gap-2">
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
                onClick={startDraft}
                disabled={saving || !schemaReady}
                className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#5B6CFF] px-4 py-2.5 text-[13px] font-medium text-white hover:bg-[#4A5AE8] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden />
                Crear agente
              </button>
            </div>
          ) : null}
        </header>
      )}

      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-5 !text-slate-900 md:px-6">
        <AiTermsCard canEdit={canEdit} />
        {!schemaReady ? (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">
            Los agentes todavía no están habilitados para esta cuenta: la pantalla es de solo lectura y no se
            pueden crear ni sembrar agentes.
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            {notice}
          </div>
        ) : null}
        {error && !(loadFailed && agents.length === 0) ? (
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
        ) : loadFailed && agents.length === 0 && !draftMode ? (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200/70">
            <AuroraErrorState
              title="No pudimos cargar tus agentes"
              description="Tus agentes no se borraron; solo falló la consulta. Probá de nuevo."
              onRetry={() => void load()}
            />
          </div>
        ) : isEmpty && !draftMode ? (
          <div className="rounded-2xl bg-white ring-1 ring-slate-200/70">
            <AuroraEmptyState
              icon="✨"
              title="Todavía no hay agentes"
              description={
                !canEdit
                  ? 'Necesitás permiso de configuración para crear agentes.'
                  : !schemaReady
                    ? 'Los agentes todavía no están habilitados para esta cuenta.'
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
                      onClick={startDraft}
                      disabled={saving}
                      className={`${auroraButtonSecondary} disabled:opacity-50`}
                    >
                      Crear agente
                    </button>
                  </>
                ) : null
              }
            />
          </div>
        ) : (
          <>
            {view === 'list' && !draftMode ? (
              <AgentListPanel
                agents={agents}
                selectedId={null}
                onConfigure={(id) => openAgent(id)}
                onProbar={(id) => probar(id)}
                onCreate={canCreate ? startDraft : undefined}
                createDisabled={saving}
              />
            ) : null}

            {draftMode ? (
              <NewAgentForm
                tab={tab}
                draft={newDraft}
                disabled={!canEdit || saving}
                onChange={(patchDraft) => setNewDraft((d) => ({ ...d, ...patchDraft }))}
              />
            ) : null}

            {/*
              All tab panels stay mounted (toggled with `hidden`) once an agent is opened, so editors
              keep state and switching tabs / list ↔ detail never remounts or re-fetches bindings.
            */}
            {selected ? (
              <div className="space-y-4">
                <div hidden={!detailVisible || tab !== 'resumen'} role="tabpanel" className="space-y-4">
                  <StudioFlow key={`studio-${selected.id}`} agentId={selected.id} canEdit={canEdit} isLive={selected.status === 'live'} onApplied={() => {
                      setStudioApplied((n) => n + 1)
                      void load({ silent: true })
                    }} />
                  <AgentInventoryCard key={`inv-${selected.id}-${selected.version}-${studioApplied}`} agentId={selected.id} canEdit={canEdit} title="② Productos que vende" />
                  <AgentPromoCard key={`promo-${selected.id}`} agentId={selected.id} canEdit={canEdit} />
                  <div id="agent-probar">
                    <p className="mb-2 text-[14px] font-semibold text-slate-900">③ Probar y activar</p>
                    <AgentDisclosureToggle key={`disc-${selected.id}`} agentId={selected.id} canEdit={canEdit} />
                    <AgentTestSandbox
                      key={selected.id}
                      agentId={selected.id}
                      agentName={selected.name}
                      canEdit={canEdit}
                      channels={testChannels}
                      channelsLoaded={channelsLoaded}
                      socialAccountId={channelId}
                      onSelectChannel={setChannelId}
                      onUnlocked={() => setChannelReload((value) => value + 1)}
                      agentModel={selected.model}
                      configuredModels={configuredModels}
                      operationMode={selected.operationMode}
                    />
                  </div>
                  <details className="rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5" data-testid="agent-resumen-avanzado">
                    <summary className="cursor-pointer text-[13px] font-semibold text-slate-700">Avanzado: personalidad, líneas, conocimiento, herramientas y estado</summary>
                    <div className="mt-4 space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className={CARD}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-[14px] font-semibold text-slate-900">
                          Personalidad y voz
                        </h3>
                        <button
                          type="button"
                          onClick={() => goTab('personalidad')}
                          className="text-[12px] font-medium text-au-ink-5b6cff"
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
                      <p className="mt-3 line-clamp-4 rounded-xl bg-au-tint-f5f4ff px-3 py-2.5 text-[12px] leading-relaxed text-slate-700 ring-1 ring-[#5B6CFF]/10">
                        {selected.systemInstructions?.trim() || 'Sin instrucciones de voz todavía.'}
                      </p>
                    </div>

                    <div className={CARD}>
                      <div className="flex items-center justify-between">
                        <h3 className="text-[14px] font-semibold text-slate-900">Líneas</h3>
                        <button
                          type="button"
                          onClick={() => goTab('canales')}
                          className="text-[12px] font-medium text-au-ink-5b6cff"
                        >
                          {canEdit ? 'Elegir líneas' : 'Ver líneas'}
                        </button>
                      </div>
                      {!hasBindData ? (
                        <p className="mt-3 text-[12px] text-slate-500">Cargando líneas…</p>
                      ) : attendingRows.length === 0 ? (
                        <p
                          className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-100"
                          data-testid="resumen-attends-nobody"
                        >
                          No atiende a nadie: todavía no elegiste ninguna línea (número de WhatsApp o Instagram).
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
                          className="text-[12px] font-medium text-au-ink-5b6cff"
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
                      El agente responde solo en los canales que activaste en Probar (Probar y activar).
                      Solo humanos lo apaga en todos sus canales.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <div>
                        <p className="text-xs font-medium text-slate-700">Operación</p>
                        <select
                          className={`mt-1 ${SELECT_CLASS}`}
                          value={selected.operationMode}
                          disabled={!canEdit || saving}
                          onChange={(e) => {
                            void patch({ operationMode: e.target.value })
                          }}
                        >
                          {selected.operationMode === 'ai_suggest' ? (
                            <option value="ai_suggest" disabled>
                              Sin activar
                            </option>
                          ) : null}
                          <option value="ai_full">Responder (en canales activados)</option>
                          <option value="human_only">Solo humanos</option>
                        </select>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-700">Estado</p>
                        <select
                          className={`mt-1 ${SELECT_CLASS}`}
                          value={selected.status}
                          disabled={!canEdit || saving}
                          onChange={async (e) => {
                            const nextStatus = e.target.value
                            if (
                              nextStatus === 'live' &&
                              !await auroraConfirm(
                                '¿Pasar a En vivo? Solo agentes En vivo corren en inbound real.',
                              )
                            ) {
                              return
                            }
                            void patch({ status: nextStatus })
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
                  </details>
                </div>

                <div hidden={!detailVisible || tab !== 'personalidad'} role="tabpanel" className="space-y-4">
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
                            className="inline-flex items-center gap-1 rounded-full bg-au-tint-eef0ff px-2.5 py-1 text-sm font-medium text-au-ink-4a5ae8 ring-1 ring-[#5B6CFF]/15"
                          >
                            {n}
                            {canEdit ? (
                              <button
                                type="button"
                                disabled={saving}
                                className="ml-0.5 text-au-ink-5b6cff hover:text-au-ink-4a5ae8 disabled:opacity-50"
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

                <div hidden={!detailVisible || tab !== 'canales'} role="tabpanel" className="space-y-4">
                  <ChannelsEditor
                    agentId={selected.id}
                    canEdit={canEdit}
                    reloadToken={channelReload}
                    onUseForTest={(id) => {
                      setChannelId(id)
                      probar()
                    }}
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
                </div>

                {/* Conocimiento — completeness cards, inline wizard, real sources */}
                <div hidden={!detailVisible || tab !== 'conocimiento'} role="tabpanel" className="space-y-4">
                  <AgentKnowledgeTab
                    agentId={selected.id}
                    canEdit={canEdit}
                    cards={knowledgeCards}
                    schemaReady={knowledgeSchemaReady}
                    cardId={cardId}
                    onSelectCard={selectKnowledgeCard}
                    onChanged={() => void load({ silent: true })}
                  />
                </div>

                <div hidden={!detailVisible || tab !== 'herramientas'} role="tabpanel" className="space-y-4">
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

                <div hidden={!detailVisible || tab !== 'seguridad'} role="tabpanel" className="space-y-4">
                  <div className={CARD}>
                    <h3 className="text-[14px] font-semibold text-slate-900">Detener agente</h3>
                    <p className={`mt-0.5 ${HINT_CLASS}`}>
                      Pausá la línea, pasá a solo humanos, o sacala de la lista.
                      {channelId
                        ? ' Aplica a la línea elegida en Probar.'
                        : ' Elegí una línea en Líneas → Probar para acotarla.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => void panic('pause_channel')}
                        className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 ring-1 ring-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Pausar línea
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
                      Modelo: <span title={selected.model}>{modelLabel(selected.model)}</span>
                    </p>
                    <AgentUsageCard />
                    <AgentBusinessCard key={`biz-${selected.id}`} agentId={selected.id} canEdit={canEdit} />
                    <AgentQualityCard key={selected.id} agentId={selected.id} canEdit={canEdit} />
                    {canEdit ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {[LUNA_CHAT_AGENT_MODEL, DEFAULT_CHAT_AGENT_MODEL]
                          .filter((m) => m !== selected.model)
                          .map((m) => {
                            const ready = !configuredModels || configuredModels.includes(m)
                            return (
                              <button
                                key={m}
                                type="button"
                                disabled={saving || !ready}
                                title={ready ? m : 'Este modelo todavía no está disponible en Betsy.'}
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      `¿Cambiar a ${modelLabel(m)}? Si el agente ya enviaba mensajes solo, ` +
                                        'tendrá que volver a aprobar el envío real con el nuevo modelo.',
                                    )
                                  ) {
                                    void patch({ model: m })
                                  }
                                }}
                                className={`${auroraButtonSecondary} disabled:opacity-50`}
                              >
                                Cambiar a {modelLabel(m)}
                                {ready ? '' : ' (no disponible todavía)'}
                              </button>
                            )
                          })}
                      </div>
                    ) : null}
                  </details>
                </div>

                <div hidden={!detailVisible || tab !== 'historial'} role="tabpanel" className="space-y-4">
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
            ) : null}
          </>
        )}
      </div>
    </AuroraShell>
  )
}
