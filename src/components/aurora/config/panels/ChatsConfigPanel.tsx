'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
import { ConfigPanelHeader } from '@/components/aurora/config/panels/ConfigPanelHeader'
import { ConfigCard } from '@/components/aurora/config/panels/ConfigCard'
import { ChatRulesEditor } from '@/components/aurora/config/panels/ChatRulesEditor'
import { refreshCrmCatalog, stageChipClass } from '@/components/chats/useCrmCatalog'
import {
  STAGE_COLORS,
  defaultStages,
  DEFAULT_CHAT_TAGS,
  type StageCategory,
  type StageDef,
  type StagePipeline,
  type TagDef,
} from '@/lib/crm-stages'

const COLOR_LABELS: Record<string, string> = {
  slate: 'Gris',
  sky: 'Celeste',
  violet: 'Violeta',
  amber: 'Ámbar',
  emerald: 'Verde',
  rose: 'Rosa',
  orange: 'Naranja',
  teal: 'Turquesa',
}
const CATEGORY_LABELS: Record<StageCategory, string> = { open: 'Abierta', won: 'Cerrada · ganada', lost: 'Cerrada · perdida' }

type Row = { key?: string; label: string; color: string | null; category: StageCategory; isSystem: boolean; archived: boolean }
type TagRow = { key?: string; label: string; color: string | null; isSystem: boolean; archived: boolean }

const inputClass =
  'min-w-0 flex-1 rounded-lg bg-white px-2.5 py-1.5 text-[13px] text-slate-900 ring-1 ring-slate-200 focus:outline-none focus:ring-au-ink-5b6cff'
const selectClass = 'rounded-lg bg-white px-2 py-1.5 text-[12px] text-slate-700 ring-1 ring-slate-200'

function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

function StageListEditor({ pipeline, title, subtitle }: { pipeline: StagePipeline; title: string; subtitle: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/config/crm-stages?pipeline=${pipeline}`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((json: { success?: boolean; stages?: StageDef[]; available?: boolean }) => {
        if (!alive) return
        const stages = json?.success && Array.isArray(json.stages) ? json.stages : defaultStages(pipeline)
        setAvailable(json?.available !== false)
        setRows(stages.map((s) => ({ key: s.key, label: s.label, color: s.color, category: s.category, isSystem: s.isSystem, archived: s.archived })))
      })
      .catch(() => alive && setRows(defaultStages(pipeline).map((s) => ({ ...s }))))
    return () => {
      alive = false
    }
  }, [pipeline])

  async function save() {
    if (!rows) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/config/crm-stages', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipeline, stages: rows }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; stages?: StageDef[]; error?: string } | null
      if (!res.ok || !json?.success) {
        setMessage({ tone: 'error', text: json?.error || 'No se pudo guardar.' })
        return
      }
      setRows((json.stages ?? []).map((s) => ({ key: s.key, label: s.label, color: s.color, category: s.category, isSystem: s.isSystem, archived: s.archived })))
      setMessage({ tone: 'ok', text: 'Guardado. Los chats ya muestran los cambios.' })
      void refreshCrmCatalog()
    } catch {
      setMessage({ tone: 'error', text: 'Sin conexión. Probá de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev))

  return (
    <ConfigCard className="p-5" data-testid={`chats-config-${pipeline}`}>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        <p className="mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p>
      </div>
      {!available ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Todavía usás la lista estándar. La personalización se activa con la próxima actualización.
        </p>
      ) : null}
      {rows === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) =>
            r.archived ? null : (
              <li key={r.key ?? `new-${i}`} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stageChipClass(r.color)}`} aria-hidden />
                <input
                  value={r.label}
                  maxLength={40}
                  onChange={(e) => update(i, { label: e.target.value })}
                  className={inputClass}
                  aria-label="Nombre de la etapa"
                />
                <select value={r.color ?? ''} onChange={(e) => update(i, { color: e.target.value || null })} className={selectClass} aria-label="Color">
                  <option value="">Sin color</option>
                  {STAGE_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {COLOR_LABELS[c]}
                    </option>
                  ))}
                </select>
                {pipeline === 'chat' && r.isSystem ? (
                  <span className="px-1 text-[11px] text-slate-400">{CATEGORY_LABELS[r.category]}</span>
                ) : (
                  <select
                    value={r.category}
                    onChange={(e) => update(i, { category: e.target.value as StageCategory })}
                    className={selectClass}
                    aria-label="Tipo"
                  >
                    {(Object.keys(CATEGORY_LABELS) as StageCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </select>
                )}
                <span className="flex items-center">
                  <button type="button" onClick={() => setRows((p) => (p ? move(p, i, -1) : p))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Subir">
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => setRows((p) => (p ? move(p, i, 1) : p))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Bajar">
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {r.isSystem ? (
                    <span className="w-6" title="Etapa del sistema: se puede renombrar, no borrar" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => update(i, { archived: true })}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Quitar etapa"
                      title="Se archiva: los chats que la tengan la siguen mostrando"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={!rows || rows.filter((r) => !r.archived).length >= 30}
          onClick={() => setRows((p) => [...(p ?? []), { label: 'Nueva etapa', color: 'slate', category: 'open', isSystem: false, archived: false }])}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-au-ink-5b6cff hover:bg-au-tint-eef0ff disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar etapa
        </button>
        <div className="flex items-center gap-2">
          {message ? (
            <span role="status" className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
              {message.text}
            </span>
          ) : null}
          <button
            type="button"
            disabled={!rows || saving || !available}
            onClick={() => void save()}
            className="inline-flex items-center gap-1 rounded-lg bg-au-ink-5b6cff px-3 py-1.5 text-[12.5px] font-semibold text-static-white disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Guardar
          </button>
        </div>
      </div>
    </ConfigCard>
  )
}

function TagListEditor() {
  const [rows, setRows] = useState<TagRow[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/config/chat-tags', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => r.json())
      .then((json: { success?: boolean; tags?: TagDef[]; available?: boolean }) => {
        if (!alive) return
        const tags = json?.success && Array.isArray(json.tags) ? json.tags : DEFAULT_CHAT_TAGS
        setAvailable(json?.available !== false)
        setRows(tags.map((t) => ({ key: t.key, label: t.label, color: t.color, isSystem: t.isSystem, archived: t.archived })))
      })
      .catch(() => alive && setRows(DEFAULT_CHAT_TAGS.map((t) => ({ ...t }))))
    return () => {
      alive = false
    }
  }, [])

  async function save() {
    if (!rows) return
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/config/chat-tags', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: rows }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; tags?: TagDef[]; error?: string } | null
      if (!res.ok || !json?.success) {
        setMessage({ tone: 'error', text: json?.error || 'No se pudo guardar.' })
        return
      }
      setRows((json.tags ?? []).map((t) => ({ key: t.key, label: t.label, color: t.color, isSystem: t.isSystem, archived: t.archived })))
      setMessage({ tone: 'ok', text: 'Guardado.' })
      void refreshCrmCatalog()
    } catch {
      setMessage({ tone: 'error', text: 'Sin conexión. Probá de nuevo.' })
    } finally {
      setSaving(false)
    }
  }

  const update = (i: number, patch: Partial<TagRow>) => setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev))

  return (
    <ConfigCard className="p-5" data-testid="chats-config-tags">
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-slate-900">Etiquetas</h2>
        <p className="mt-0.5 text-[12.5px] text-slate-500">Para marcar chats (VIP, mayorista, reclamo…) y filtrarlos en la bandeja.</p>
      </div>
      {!available ? (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Todavía usás las etiquetas estándar. La personalización se activa con la próxima actualización.
        </p>
      ) : null}
      {rows === null ? (
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {rows.map((r, i) =>
            r.archived ? null : (
              <li key={r.key ?? `new-${i}`} className="flex items-center gap-1 rounded-xl bg-slate-50 p-1.5 ring-1 ring-slate-100">
                <input
                  value={r.label}
                  maxLength={40}
                  onChange={(e) => update(i, { label: e.target.value })}
                  className="w-28 rounded-md bg-white px-2 py-1 text-[12.5px] ring-1 ring-slate-200"
                  aria-label="Nombre de la etiqueta"
                />
                <select value={r.color ?? ''} onChange={(e) => update(i, { color: e.target.value || null })} className="rounded-md bg-white px-1 py-1 text-[11.5px] ring-1 ring-slate-200" aria-label="Color">
                  <option value="">—</option>
                  {STAGE_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {COLOR_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => update(i, { archived: true })} className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Quitar etiqueta">
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={!rows}
          onClick={() => setRows((p) => [...(p ?? []), { label: 'Nueva', color: 'amber', isSystem: false, archived: false }])}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-au-ink-5b6cff hover:bg-au-tint-eef0ff disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden /> Agregar etiqueta
        </button>
        <div className="flex items-center gap-2">
          {message ? (
            <span role="status" className={`text-[12px] ${message.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>
              {message.text}
            </span>
          ) : null}
          <button
            type="button"
            disabled={!rows || saving || !available}
            onClick={() => void save()}
            className="inline-flex items-center gap-1 rounded-lg bg-au-ink-5b6cff px-3 py-1.5 text-[12.5px] font-semibold text-static-white disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Guardar
          </button>
        </div>
      </div>
    </ConfigCard>
  )
}

/** Config › Chats: stages, client lifecycle stages, tags (2a) and assignment / hours / auto-close (2b). */
export function ChatsConfigPanel() {
  return (
    <div className="space-y-4" data-testid="chats-config-panel">
      <ConfigPanelHeader
        title="Chats"
        subtitle="Etapas de las conversaciones, etapas de tus clientes y etiquetas. Renombrá, reordená o agregá las tuyas."
      />
      <StageListEditor
        pipeline="chat"
        title="Etapas de los chats"
        subtitle="Nuevo, En curso y Hecho son del sistema (se pueden renombrar). Las etapas cerradas salen de Abiertos."
      />
      <StageListEditor
        pipeline="client"
        title="Etapas de los clientes"
        subtitle="Se mueven solas según los pedidos, pagos y guías. El equipo puede fijar otra desde el chat."
      />
      <TagListEditor />
      <ChatRulesEditor />
    </div>
  )
}
