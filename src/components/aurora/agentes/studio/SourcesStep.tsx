'use client'

import { useRef, useState } from 'react'
import type { StudioSource } from './studio-types'

const KIND_ICON: Record<string, string> = { url: '🌐', file: '📄', image: '🖼️', instagram: '📸', text: '📝', wa_export: '💬' }
type Mode = 'url' | 'file' | 'instagram' | 'text'
const MODES: Array<{ key: Mode; label: string }> = [
  { key: 'url', label: 'Sitio web' },
  { key: 'file', label: 'PDF / Word / fotos' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'text', label: 'Pegar texto' },
]

function sourceDetail(s: StudioSource): string {
  if (s.status === 'failed') return s.errorCode === 'vision_unavailable' ? 'Foto guardada (no se pudo describir)' : 'No se pudo leer'
  const pages = typeof s.meta.pages === 'number' ? `${s.meta.pages} páginas · ` : s.pageCount ? `${s.pageCount} páginas · ` : ''
  const posts = typeof s.meta.posts === 'number' ? `${s.meta.posts} publicaciones · ` : ''
  return `${pages}${posts}${Math.round(s.textChars / 100) / 10}k letras`
}

/** Step 1: give the agent the business's own material. Each item is read once and listed with what was read. */
export function SourcesStep({
  agentId,
  sources,
  instagramAccounts,
  canEdit,
  onChanged,
}: {
  agentId: string
  sources: StudioSource[]
  instagramAccounts: Array<{ id: string; label: string }>
  canEdit: boolean
  onChanged: () => void
}) {
  const [mode, setMode] = useState<Mode>('url')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [igId, setIgId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const base = `/api/chat/agents/${encodeURIComponent(agentId)}/studio/sources`

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label)
    setError(null)
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(json.error || 'No se pudo agregar.')
      else {
        setUrl('')
        setText('')
        onChanged()
      }
    } catch {
      setError('Sin conexión. Probá de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    for (const file of Array.from(files).slice(0, 10)) {
      setBusy(`Leyendo ${file.name}…`)
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch(`${base}/upload`, { method: 'POST', body: form })
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) setError(`${file.name}: ${json.error || 'no se pudo leer'}`)
      } catch {
        setError(`${file.name}: sin conexión`)
      }
    }
    setBusy(null)
    if (fileRef.current) fileRef.current.value = ''
    onChanged()
  }

  async function remove(id: string) {
    setConfirmRemove(null)
    await fetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
    onChanged()
  }

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200/70">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Tipo de fuente">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => setMode(m.key)}
                className={`rounded-full px-3 py-1 text-[12px] font-medium ${mode === m.key ? 'bg-[#5B6CFF] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {mode === 'url' ? (
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (url.trim()) void post({ kind: 'url', url: url.trim() }, 'Leyendo el sitio (hasta 1 minuto)…')
                }}
              >
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://tutienda.com"
                  inputMode="url"
                  className="min-h-[40px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px]"
                />
                <button type="submit" disabled={!!busy || !url.trim()} className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40">
                  Leer sitio
                </button>
              </form>
            ) : mode === 'file' ? (
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.txt,image/jpeg,image/png,image/webp"
                  onChange={(e) => void upload(e.target.files)}
                  disabled={!!busy}
                  className="text-[13px]"
                />
                <p className="text-[11px] text-slate-500">Catálogos, listas de precios, políticas o fotos de productos. Máx. 10 MB cada uno.</p>
              </div>
            ) : mode === 'instagram' ? (
              instagramAccounts.length ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select value={igId} onChange={(e) => setIgId(e.target.value)} className="min-h-[40px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px]">
                    <option value="">Elegí la cuenta…</option>
                    {instagramAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!!busy || !igId}
                    onClick={() => void post({ kind: 'instagram', socialAccountId: igId }, 'Leyendo Instagram…')}
                    className="min-h-[40px] rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40"
                  >
                    Leer bio y publicaciones
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-slate-500">Este negocio no tiene una cuenta de Instagram conectada.</p>
              )
            ) : (
              <div className="flex flex-col gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  placeholder="Pegá lo que sepas del negocio: precios, envíos, cómo pagan, horarios, preguntas frecuentes…"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px]"
                />
                <button
                  type="button"
                  disabled={!!busy || text.trim().length < 20}
                  onClick={() => void post({ kind: 'text', text }, 'Guardando…')}
                  className="min-h-[40px] self-start rounded-lg bg-slate-900 px-4 text-[13px] font-medium text-white disabled:opacity-40"
                >
                  Agregar texto
                </button>
              </div>
            )}
          </div>
          {busy ? <p className="mt-2 text-[12px] text-au-ink-5b6cff">{busy}</p> : null}
          {error ? <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800 ring-1 ring-rose-100">{error}</p> : null}
        </div>
      ) : null}

      {sources.length ? (
        <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200/70" data-testid="studio-sources">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2">
              <span aria-hidden className="text-[16px]">{KIND_ICON[s.kind] || '📎'}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-slate-800">{s.label}</p>
                <p className={`text-[11px] ${s.status === 'failed' ? 'text-amber-700' : 'text-slate-500'}`}>{sourceDetail(s)}</p>
              </div>
              {canEdit ? (
                confirmRemove === s.id ? (
                  <span className="flex gap-1">
                    <button type="button" onClick={() => void remove(s.id)} className="rounded-md bg-rose-600 px-2 py-1 text-[11px] text-white">
                      Quitar
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className="rounded-md px-2 py-1 text-[11px] text-slate-500">
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirmRemove(s.id)} className="text-[12px] text-slate-400 hover:text-rose-600" aria-label={`Quitar ${s.label}`}>
                    ✕
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-slate-500">Todavía no hay fuentes. Empezá por el sitio web o un catálogo.</p>
      )}
    </div>
  )
}
