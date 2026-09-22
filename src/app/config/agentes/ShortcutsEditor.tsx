'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { EMPTY_BRAND_FACTS, parseBrandFactsSafe, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import {
  MISSING_FACT_CHIP_HINT,
  previewStarterChip,
  renderShortcutTemplate,
} from '@/lib/soft-ai/shortcuts'

type ShortcutRow = {
  id: string
  key: string
  title: string
  kind: string
  body: string
  deliveryMode: string
  isActive: boolean
  keywords: string[]
  intents: string[]
}

type Template = {
  key: string
  title: string
  kind: string
  body: string
  deliveryMode: 'verbatim' | 'guide'
  intents: string[]
  keywords: string[]
}

const FIELD =
  'mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm !text-slate-900 disabled:bg-slate-100 disabled:!text-slate-600'
const HINT = 'text-[11px] text-slate-600'

export function ShortcutsEditor({
  agentId,
  canEdit,
  reloadToken = 0,
}: {
  agentId: string
  canEdit: boolean
  reloadToken?: number
}) {
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [facts, setFacts] = useState<BrandFacts>(EMPTY_BRAND_FACTS)
  const [error, setError] = useState<string | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)
  const [advanced, setAdvanced] = useState(false)

  const load = useCallback(async () => {
    const [shortcutRes, agentRes] = await Promise.all([
      fetch(`/api/chat/agents/${agentId}/shortcuts`),
      fetch(`/api/chat/agents/${agentId}`),
    ])
    const data = await shortcutRes.json()
    if (!shortcutRes.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los atajos')
      return
    }
    setSchemaReady(data.schemaReady !== false)
    setShortcuts(data.shortcuts || [])
    setTemplates(data.templates || [])
    if (agentRes.ok) {
      const agentData = await agentRes.json()
      setFacts(parseBrandFactsSafe(agentData.agent?.brandFacts))
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load, reloadToken])

  async function addChip(template: Template) {
    if (!canEdit) return
    const preview = previewStarterChip(template, facts)
    if (preview.disabled) return
    setError(null)
    const res = await fetch(`/api/chat/agents/${agentId}/shortcuts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: template.key,
        title: template.title,
        kind: template.kind,
        intents: template.intents,
        keywords: template.keywords,
        body: preview.body,
        deliveryMode: template.deliveryMode,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudo agregar')
      return
    }
    await load()
  }

  async function patch(row: ShortcutRow, body: Partial<ShortcutRow>) {
    if (!canEdit) return
    setError(null)
    const res = await fetch(`/api/chat/agents/${agentId}/shortcuts/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.code === 'confirmation_wording' ? 'Ese texto confirma un pago. No se puede guardar.' : (data.error || 'Error'))
      return
    }
    await load()
  }

  async function remove(row: ShortcutRow) {
    if (!canEdit || row.key.startsWith('sys_')) return
    setError(null)
    const res = await fetch(`/api/chat/agents/${agentId}/shortcuts/${row.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudo borrar')
      return
    }
    await load()
  }

  const existingKeys = new Set(shortcuts.map((row) => row.key))
  const visible = advanced ? shortcuts : shortcuts.filter((row) => !row.key.startsWith('sys_'))
  const anyChipBlocked = templates.some((template) => previewStarterChip(template, facts).disabled)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Atajos</h2>
        <button
          type="button"
          aria-pressed={advanced}
          onClick={() => setAdvanced((value) => !value)}
          className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-800 ring-1 ring-slate-200"
        >
          {advanced ? 'Ocultar avanzado' : 'Avanzado'}
        </button>
      </div>
      <p className={`mt-0.5 ${HINT}`}>Texto que ve el cliente, y si esa respuesta está activa.</p>
      {!schemaReady ? <p className="mt-2 text-xs text-amber-800">Esquema pendiente (SQL 029).</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {templates
          .filter((template) => !existingKeys.has(template.key))
          .map((template) => {
            const preview = previewStarterChip(template, facts)
            return (
              <button
                key={template.key}
                type="button"
                disabled={!canEdit || preview.disabled}
                title={preview.hint || undefined}
                onClick={() => void addChip(template)}
                className="rounded-lg bg-slate-50 px-2 py-1 text-xs !text-slate-900 ring-1 ring-slate-200 disabled:bg-slate-100 disabled:!text-slate-600"
              >
                + {template.title}
              </button>
            )
          })}
      </div>
      {anyChipBlocked ? <p className={`mt-2 ${HINT}`}>{MISSING_FACT_CHIP_HINT}</p> : null}
      <ul className="mt-3 space-y-3">
        {visible.map((row) => {
          const customerText = renderShortcutTemplate(row.body, { facts }).replace(/\s{2,}/g, ' ').trim()
          return (
            <li key={row.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{row.title}</p>
                <label className="inline-flex items-center gap-1 text-xs text-slate-800">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    disabled={!canEdit}
                    onChange={(e) => void patch(row, { isActive: e.target.checked })}
                  />
                  Activo
                </label>
              </div>
              <textarea
                className={FIELD}
                rows={3}
                defaultValue={advanced ? row.body : customerText}
                key={`${row.id}-${advanced}-${row.body}`}
                disabled={!canEdit}
                onBlur={(e) => {
                  const next = e.target.value
                  const baseline = advanced ? row.body : customerText
                  if (next !== baseline) void patch(row, { body: next })
                }}
              />
              {advanced ? (
                <div className="mt-2 space-y-1">
                  <p className={`${HINT} font-mono`}>
                    {row.key} · {row.kind} · {row.deliveryMode}
                  </p>
                  <div className="flex items-center justify-between">
                    <button type="button" disabled className="cursor-not-allowed rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-600">
                      Imágenes — disponible en A2
                    </button>
                    {row.key.startsWith('sys_') ? (
                      <span className={HINT}>Reservado</span>
                    ) : (
                      <button type="button" disabled={!canEdit} onClick={() => void remove(row)} className="text-xs text-red-800">
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
