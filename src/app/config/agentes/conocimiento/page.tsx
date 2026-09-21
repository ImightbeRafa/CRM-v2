'use client'

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { hasSessionPermission } from '@/lib/session-permissions'
import { FORGE_WA_SOCIAL_ACCOUNT_ID } from '@/lib/soft-ai/agent-types'
import {
  KNOWLEDGE_CHECKLIST_CARDS,
  KNOWLEDGE_KINDS,
  reviewKnowledgeBody,
  type KnowledgeKind,
} from '@/lib/soft-ai/knowledge-types'

type SourceRow = {
  id: string
  kind: KnowledgeKind
  name: string
  body: string
  status: string
  version: number
  approvedBy: string | null
  approvedAt: string | null
  socialAccountId: string | null
}

const KIND_LABELS: Record<KnowledgeKind, string> = {
  brand_book: 'Brand Book',
  policy: 'Política',
  faq: 'FAQ',
  channel_overlay: 'Overlay de canal',
}

type Step = 'pegar' | 'revisar' | 'aprobar'

/** Light-surface form controls: explicit foreground so dark theme cannot inherit pale text. */
const FIELD_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm !text-slate-900 placeholder:!text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:!text-slate-600'
const TEXTAREA_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm !text-slate-900 placeholder:!text-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:!text-slate-600'
const HINT_CLASS = 'text-[11px] text-slate-600'

function ConocimientoWizardInner() {
  const router = useRouter()
  const search = useSearchParams()
  const { data: session } = useSession()
  const canEdit = hasSessionPermission(session, 'update_config')

  const presetCard = search.get('card')
  const preset = KNOWLEDGE_CHECKLIST_CARDS.find((c) => c.id === presetCard)

  const [step, setStep] = useState<Step>('pegar')
  const [kind, setKind] = useState<KnowledgeKind>(preset?.kind || 'policy')
  const [name, setName] = useState<string>(preset?.nameHint || 'Políticas')
  const [body, setBody] = useState('')
  const [socialAccountId, setSocialAccountId] = useState<string>(FORGE_WA_SOCIAL_ACCOUNT_ID)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [sources, setSources] = useState<SourceRow[]>([])
  const [schemaReady, setSchemaReady] = useState(true)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const review = useMemo(() => reviewKnowledgeBody(body), [body])

  const load = useCallback(async () => {
    try {
      const [kRes, aRes] = await Promise.all([
        fetch('/api/chat/knowledge'),
        fetch('/api/chat/agents'),
      ])
      const kData = await kRes.json()
      const aData = await aRes.json()
      setSchemaReady(kData.schemaReady !== false)
      setSources(kData.sources || [])
      if (aData.agents?.[0]?.id) setAgentId(aData.agents[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createDraft() {
    if (!canEdit) return
    setSaving(true)
    setError(null)
    setOkMsg(null)
    try {
      const res = await fetch('/api/chat/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          name,
          body,
          socialAccountId: kind === 'channel_overlay' ? socialAccountId : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al crear borrador')
      setSourceId(data.source.id)
      setStep('revisar')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function approve() {
    if (!canEdit || !sourceId) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/chat/knowledge/${sourceId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al aprobar')
      if (agentId) {
        await fetch(`/api/chat/agents/${agentId}/knowledge-sources`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId }),
        })
      }
      setOkMsg('Fuente aprobada. Solo versiones approved entran al prompt.')
      setStep('aprobar')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  async function reject() {
    if (!canEdit || !sourceId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/chat/knowledge/${sourceId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: 'rechazado en wizard' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setOkMsg('Borrador archivado (rechazado).')
      setStep('pegar')
      setSourceId(null)
      setBody('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 !text-slate-900 [color-scheme:light]">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <button
          type="button"
          onClick={() => router.push('/config/agentes')}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver a agentes
        </button>

        <div className="mb-6 flex items-start gap-3">
          <div className="rounded-xl bg-indigo-100 p-2.5 text-indigo-700">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Conocimiento del agente</h1>
            <p className="mt-1 text-sm text-slate-600">
              Pegá texto → Revisá → Aprobá. Solo fuentes aprobadas entran al prompt como datos (no
              instrucciones). El inventario en vivo manda para precios.
            </p>
          </div>
        </div>

        {!schemaReady ? (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            SQL 028 aún no aplicado — podés preparar el wizard, pero crear/aprobar falla hasta el
            apply gated.
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
        {okMsg ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {okMsg}
          </div>
        ) : null}

        <div className="mb-4 flex gap-2 text-xs font-semibold uppercase tracking-wide">
          {(['pegar', 'revisar', 'aprobar'] as Step[]).map((s) => (
            <span
              key={s}
              className={`rounded-full px-3 py-1 ${
                step === s
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200'
              }`}
            >
              {s === 'pegar' ? '1. Pegar texto' : s === 'revisar' ? '2. Revisar' : '3. Aprobar'}
            </span>
          ))}
        </div>

        {step === 'pegar' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block text-xs font-medium text-slate-700">Tipo</label>
            <select
              className={`mt-1 ${FIELD_CLASS}`}
              value={kind}
              disabled={!canEdit || saving}
              onChange={(e) => setKind(e.target.value as KnowledgeKind)}
            >
              {KNOWLEDGE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>

            <label className="mt-3 block text-xs font-medium text-slate-700">Nombre</label>
            <input
              className={`mt-1 ${FIELD_CLASS}`}
              value={name}
              disabled={!canEdit || saving}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />

            {kind === 'channel_overlay' ? (
              <>
                <label className="mt-3 block text-xs font-medium text-slate-700">
                  Canal (SocialAccount)
                </label>
                <input
                  className={`mt-1 ${FIELD_CLASS}`}
                  value={socialAccountId}
                  disabled={!canEdit || saving}
                  onChange={(e) => setSocialAccountId(e.target.value)}
                />
              </>
            ) : null}

            <label className="mt-3 block text-xs font-medium text-slate-700">
              Texto (Markdown / plano, máx. 12 000)
            </label>
            <textarea
              className={`mt-1 ${TEXTAREA_CLASS}`}
              rows={12}
              value={body}
              disabled={!canEdit || saving}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Pegá Brand Book, política, FAQ u overlay…"
            />
            <p className={`mt-1 ${HINT_CLASS}`}>
              {body.length.toLocaleString('es-CR')} / 12 000
              {review.inventoryWinsWarning
                ? ' · Se detectaron cifras: el inventario en vivo manda'
                : ''}
            </p>

            <button
              type="button"
              disabled={
                !canEdit ||
                saving ||
                !schemaReady ||
                !body.trim() ||
                !name.trim() ||
                review.overLimit
              }
              onClick={() => void createDraft()}
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-indigo-400 disabled:text-white"
              title={
                !schemaReady
                  ? 'SQL 028 aún no aplicado — no se puede guardar'
                  : undefined
              }
            >
              {schemaReady ? 'Guardar borrador y revisar' : 'Guardar (espera SQL 028)'}
            </button>
          </div>
        ) : null}

        {step === 'revisar' || step === 'aprobar' ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Vista previa (como lo verá el agente — datos, no instrucciones)
            </h2>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[12px] !text-slate-900 ring-1 ring-slate-200">
              {body}
            </pre>
            {review.monetaryFigures.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-medium">Cifras detectadas — el inventario en vivo manda</p>
                <p className="mt-1 text-[12px] text-amber-950">
                  {review.monetaryFigures.slice(0, 12).join(' · ')}
                </p>
              </div>
            ) : null}

            {step === 'revisar' ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => void approve()}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-emerald-400 disabled:text-white"
                >
                  Aprobar
                </button>
                <button
                  type="button"
                  disabled={!canEdit || saving}
                  onClick={() => void reject()}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setStep('pegar')}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                >
                  Volver a editar
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  setStep('pegar')
                  setBody('')
                  setSourceId(null)
                  setOkMsg(null)
                }}
              >
                Pegar otra fuente
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-900">Fuentes del tenant</h2>
          <ul className="mt-2 space-y-2">
            {sources.length === 0 ? (
              <li className="text-sm text-slate-600">Todavía no hay fuentes.</li>
            ) : (
              sources.slice(0, 30).map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <span className="font-medium text-slate-900">{s.name}</span>{' '}
                  <span className="text-slate-600">
                    · {KIND_LABELS[s.kind]} · v{s.version} · {s.status}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}

export default function ConocimientoWizardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 p-6 text-sm text-slate-700 [color-scheme:light]">
          Cargando…
        </div>
      }
    >
      <ConocimientoWizardInner />
    </Suspense>
  )
}
