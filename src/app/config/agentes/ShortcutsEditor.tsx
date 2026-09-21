'use client'

import React, { useCallback, useEffect, useState } from 'react'

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

type Template = { key: string; title: string }

const HINT = 'text-[11px] text-slate-600'

export function ShortcutsEditor({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [shortcuts, setShortcuts] = useState<ShortcutRow[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [error, setError] = useState<string | null>(null)
  const [schemaReady, setSchemaReady] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch(`/api/chat/agents/${agentId}/shortcuts`)
    const data = await res.json()
    if (!res.ok) {
      setError(typeof data.error === 'string' ? data.error : 'No se pudieron cargar los atajos')
      return
    }
    setSchemaReady(data.schemaReady !== false)
    setShortcuts(data.shortcuts || [])
    setTemplates(data.templates || [])
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function cloneTemplate(templateKey: string) {
    if (!canEdit) return
    setError(null)
    const res = await fetch(`/api/chat/agents/${agentId}/shortcuts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateKey }),
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

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">Atajos</h2>
      <p className={`mt-0.5 ${HINT}`}>
        Playbooks editables. Los sys_* son reservados. El selector de imágenes queda para la siguiente fase.
      </p>
      {!schemaReady ? <p className="mt-2 text-xs text-amber-800">Esquema pendiente (SQL 029).</p> : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {templates
          .filter((template) => !existingKeys.has(template.key))
          .map((template) => (
            <button
              key={template.key}
              type="button"
              disabled={!canEdit}
              onClick={() => void cloneTemplate(template.key)}
              className="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-800 ring-1 ring-slate-200 disabled:opacity-60"
            >
              + {template.title}
            </button>
          ))}
      </div>
      <ul className="mt-3 space-y-3">
        {shortcuts.map((row) => (
          <li key={row.id} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                {row.title} <span className="font-mono text-[11px] text-slate-500">{row.key}</span>
              </p>
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
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm !text-slate-900 disabled:bg-slate-100"
              rows={3}
              defaultValue={row.body}
              key={`${row.id}-${row.body.length}`}
              disabled={!canEdit}
              onBlur={(e) => {
                if (e.target.value !== row.body) void patch(row, { body: e.target.value })
              }}
            />
            <div className="mt-2 flex items-center justify-between">
              <button type="button" disabled className="cursor-not-allowed rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-500">
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
          </li>
        ))}
      </ul>
    </div>
  )
}
