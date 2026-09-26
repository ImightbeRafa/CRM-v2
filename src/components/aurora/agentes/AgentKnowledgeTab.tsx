'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ConocimientoWizardInner } from '@/app/config/agentes/conocimiento/ConocimientoWizard'
import { CARD_STATE_TEXT, cardState, type CardState, type KnowledgeCard } from './knowledge-format'
import { KnowledgeSourcesTable, type KnowledgeSourceRow } from './KnowledgeSourcesTable'

const BAR: Record<CardState, { fill: string; width: string }> = {
  approved: { fill: 'bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF]', width: '100%' },
  inventory: { fill: 'bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF]', width: '100%' },
  draft: { fill: 'bg-amber-400', width: '50%' },
  empty: { fill: 'bg-slate-200', width: '0%' },
}

const TEXT_TONE: Record<CardState, string> = {
  approved: 'text-[#5B3FE0]',
  inventory: 'text-[#5B3FE0]',
  draft: 'text-amber-700',
  empty: 'text-red-600',
}

/**
 * Conocimiento tab (frame 192:2569): completeness cards from the real checklist, the inline
 * Pegar → Revisar → Aprobar wizard (bound to THIS agent) and the real Fuentes table.
 */
export function AgentKnowledgeTab({
  agentId,
  canEdit,
  cards,
  schemaReady,
  cardId,
  onSelectCard,
  onChanged,
}: {
  agentId: string
  canEdit: boolean
  cards: KnowledgeCard[]
  schemaReady: boolean
  /** Preset card from `&card=`. */
  cardId: string | null
  onSelectCard: (id: string | null) => void
  /** Reload the checklist counts after a draft / approval. */
  onChanged: () => void
}) {
  const [sources, setSources] = useState<KnowledgeSourceRow[]>([])
  const [bound, setBound] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const wizardRef = useRef<HTMLDivElement>(null)
  const requestRef = useRef(0)

  const loadSources = useCallback(async () => {
    const requestId = ++requestRef.current
    try {
      const [sRes, bRes] = await Promise.all([
        fetch('/api/chat/knowledge'),
        fetch(`/api/chat/agents/${agentId}/knowledge-sources`),
      ])
      const sData = await sRes.json()
      if (requestRef.current !== requestId) return
      if (!sRes.ok) throw new Error(typeof sData?.error === 'string' ? sData.error : 'No se pudieron cargar las fuentes')
      setUnavailable(sData.schemaReady === false)
      setSources(
        ((sData.sources || []) as KnowledgeSourceRow[]).map((s) => ({
          id: s.id,
          kind: s.kind,
          name: s.name,
          status: s.status,
          version: s.version,
          updatedAt: s.updatedAt,
        })),
      )
      if (bRes.ok) {
        const bData = await bRes.json()
        setBound(new Set<string>(bData.knowledgeSourceIds || []))
      }
      setError(null)
    } catch (e) {
      if (requestRef.current !== requestId) return
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las fuentes')
    } finally {
      if (requestRef.current === requestId) setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    setLoading(true)
    void loadSources()
  }, [loadSources])

  const handleChanged = useCallback(() => {
    void loadSources()
    onChanged()
  }, [loadSources, onChanged])

  function pasteText() {
    onSelectCard(null)
    setResetKey((k) => k + 1)
    setTimeout(() => wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  return (
    <div className="space-y-4" data-testid="agent-knowledge-tab">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="knowledge-cards">
        {cards.map((card) => {
          const state = cardState(card)
          const selected = cardId === card.id
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelectCard(card.id)}
              aria-pressed={selected}
              className={`rounded-2xl border bg-white px-4 py-3.5 text-left transition-shadow hover:shadow-sm ${
                state === 'empty' ? 'border-red-200' : 'border-slate-200/70'
              } ${selected ? 'ring-2 ring-[#5B6CFF]/40' : ''}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#0E0D17]">{card.title}</span>
                <span className={`text-[12px] font-semibold ${TEXT_TONE[state]}`}>{CARD_STATE_TEXT[state]}</span>
              </span>
              <span className="mt-2.5 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span className={`block h-full rounded-full ${BAR[state].fill}`} style={{ width: BAR[state].width }} />
              </span>
              <span className="mt-2 block text-[12px] text-slate-400">{card.statusLabel}</span>
            </button>
          )
        })}
      </div>

      <div ref={wizardRef} className="scroll-mt-4 rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5">
        <Suspense fallback={<p className="text-[13px] text-slate-500">Cargando…</p>}>
          <ConocimientoWizardInner
            key={`${cardId ?? 'wizard'}-${resetKey}`}
            variant="inline"
            cardId={cardId}
            agentId={agentId}
            onChanged={handleChanged}
          />
        </Suspense>
      </div>

      <KnowledgeSourcesTable
        sources={sources}
        boundIds={bound}
        loading={loading}
        error={error}
        unavailable={unavailable || !schemaReady}
        canEdit={canEdit}
        onPasteText={pasteText}
      />
    </div>
  )
}
