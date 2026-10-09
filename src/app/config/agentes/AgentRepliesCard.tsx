'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Reply = {
  id: string
  key: string
  title: string
  kind: string
  body: string
  deliveryMode: 'verbatim' | 'guide'
  isActive: boolean
  keywords: string[]
}
type Asset = { id: string; name: string; url: string }

const ERRORS: Record<string, string> = {
  confirmation_wording: 'No puede decir que un pago está confirmado: eso lo confirma una persona.',
  shortcut_body_invalid: 'El texto no puede quedar vacío (máx. 1500 letras).',
  shortcut_title_invalid: 'Poné un nombre corto (máx. 60 letras).',
  shortcut_exists: 'Ya hay una respuesta con ese nombre.',
  shortcut_keywords_invalid: 'Máximo 20 palabras clave.',
  SCHEMA_NOT_READY: 'Esto todavía no está disponible.',
  AGENT_NOT_FOUND: 'No se encontró el agente.',
  SHORTCUT_NOT_FOUND: 'Esa respuesta ya no existe. Recargá la página.',
}
// Spanish messages from the server pass through; internal codes never reach the owner.
const errorText = (code: unknown) =>
  (typeof code === 'string' && ERRORS[code]) || (typeof code === 'string' && /\s/.test(code) ? code : 'No se pudo guardar. Probá de nuevo.')

const isOwnerReply = (row: { key: string; kind: string }) => row.kind === 'playbook' && !row.key.startsWith('sys_')

function keyFromTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
  return `r_${slug || 'respuesta'}_${Math.random().toString(36).slice(2, 6)}`
}

/**
 * "③ Respuestas guardadas": the agent's own replies (with images: size guide, promo flyer…). "Rápida" ones go
 * out as-is when a keyword matches (instant, no thinking); the rest the agent adapts and sends with their images.
 */
export function AgentRepliesCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const base = `/api/chat/agents/${encodeURIComponent(agentId)}`
  const [replies, setReplies] = useState<Reply[] | null>(null)
  const [assets, setAssets] = useState<Asset[]>([])
  const [links, setLinks] = useState<Record<string, string[]>>({})
  const [imagesReady, setImagesReady] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadFor = useRef<string | null>(null)

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      fetch(`${base}/shortcuts`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      fetch(`${base}/assets`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ])
    setReplies(((s?.shortcuts ?? []) as Reply[]).filter(isOwnerReply))
    setAssets((a?.assets ?? []) as Asset[])
    setLinks((a?.links ?? {}) as Record<string, string[]>)
    setImagesReady(a?.available !== false)
  }, [base])

  useEffect(() => {
    void load()
  }, [load])

  async function call(label: string, url: string, init: RequestInit, done?: string) {
    setBusy(label)
    setMsg(null)
    const res = await fetch(url, init).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setMsg(errorText(json.error))
      return null
    }
    if (done) setMsg(done)
    return json
  }

  const jsonInit = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  async function patch(row: Reply, change: Partial<Reply>) {
    setReplies((prev) => prev?.map((r) => (r.id === row.id ? { ...r, ...change } : r)) ?? prev)
    const ok = await call(row.id, `${base}/shortcuts/${row.id}`, jsonInit('PATCH', change))
    if (!ok) await load()
  }

  async function library(action: 'seed' | 'import') {
    const json = await call(action, `${base}/shortcuts/library`, jsonInit('POST', { action }))
    if (!json) return
    setMsg(
      action === 'seed'
        ? `Listo: ${json.added} respuestas de venta agregadas (apagadas). Revisá el texto, agregá imágenes y encendé las que uses.`
        : `Listo: ${json.added} copiadas${json.images ? `, ${json.images} imágenes` : ''}${json.skipped ? ` · ${json.skipped} ya estaban o no se pudieron copiar` : ''}. Quedan apagadas hasta que las encendás.`,
    )
    await load()
  }

  async function create() {
    if (!newTitle.trim() || !newBody.trim()) return
    const json = await call(
      'new',
      `${base}/shortcuts`,
      jsonInit('POST', {
        key: keyFromTitle(newTitle),
        title: newTitle.trim(),
        kind: 'playbook',
        intents: [],
        keywords: [],
        body: newBody.trim(),
        deliveryMode: 'guide',
        isActive: true,
      }),
    )
    if (!json) return
    setNewTitle('')
    setNewBody('')
    await load()
  }

  async function setImages(row: Reply, assetIds: string[]) {
    const json = await call(row.id, `${base}/shortcuts/${row.id}/assets`, jsonInit('PUT', { assetIds }))
    if (json) setLinks((prev) => ({ ...prev, [row.id]: Array.isArray(json.assetIds) ? (json.assetIds as string[]) : assetIds }))
  }

  async function upload(file: File) {
    const target = replies?.find((r) => r.id === uploadFor.current)
    if (!target) return
    const form = new FormData()
    form.append('file', file)
    const json = await call(target.id, `${base}/assets/upload`, { method: 'POST', body: form })
    if (!json?.asset) return
    setAssets((prev) => (prev.some((a) => a.id === json.asset.id) ? prev : [json.asset, ...prev]))
    await setImages(target, [...(links[target.id] ?? []), json.asset.id])
  }

  if (!replies) return null
  const byId = new Map(assets.map((a) => [a.id, a]))

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-900">③ Respuestas guardadas</h2>
      <p className="mt-0.5 text-[11px] text-slate-600">
        Lo que siempre contestás igual (tallas, promo, envío…), con sus imágenes. El agente las usa en vez de inventar.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!canEdit || busy !== null} onClick={() => void library('seed')} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          + Respuestas de venta listas
        </button>
        <button type="button" disabled={!canEdit || busy !== null} onClick={() => void library('import')} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50">
          Copiar mis respuestas rápidas del chat
        </button>
      </div>
      {msg ? <p className="mt-2 text-[12px] text-slate-700" role="status">{msg}</p> : null}
      {!imagesReady ? <p className="mt-2 text-[11px] text-amber-800">Las imágenes todavía no están disponibles en este servidor.</p> : null}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void upload(file)
        }}
      />

      <ul className="mt-3 space-y-2">
        {replies.map((row) => {
          const imgs = (links[row.id] ?? []).map((id) => byId.get(id)).filter((a): a is Asset => Boolean(a))
          const quick = row.deliveryMode === 'verbatim'
          return (
            <li key={row.id} className={`rounded-lg p-3 ring-1 ${row.isActive ? 'ring-indigo-200 bg-indigo-50/30' : 'ring-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-medium text-slate-900">{row.title}</p>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-700">
                  <input type="checkbox" checked={row.isActive} disabled={!canEdit || busy === row.id} onChange={(e) => void patch(row, { isActive: e.target.checked })} />
                  {row.isActive ? 'Encendida' : 'Apagada'}
                </label>
              </div>
              <textarea
                key={`${row.id}-${row.body}`}
                defaultValue={row.body}
                rows={2}
                disabled={!canEdit}
                onBlur={(e) => {
                  const body = e.target.value.trim()
                  if (body && body !== row.body) void patch(row, { body })
                }}
                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm !text-slate-900 disabled:bg-slate-100"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {imgs.map((img) => (
                  <span key={img.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin agent image */}
                    <img src={img.url} alt={img.name} className="h-16 w-16 rounded-md object-cover ring-1 ring-slate-200" />
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`Quitar ${img.name}`}
                        onClick={() => void setImages(row, (links[row.id] ?? []).filter((id) => id !== img.id))}
                        className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full bg-white text-[11px] text-slate-700 shadow ring-1 ring-slate-200"
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
                {canEdit && imagesReady && imgs.length < 3 ? (
                  <button
                    type="button"
                    disabled={busy === row.id}
                    onClick={() => {
                      uploadFor.current = row.id
                      fileRef.current?.click()
                    }}
                    className="h-16 w-16 rounded-md text-[11px] text-slate-600 ring-1 ring-dashed ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {busy === row.id ? '…' : '+ Imagen'}
                  </button>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-700">
                <select
                  value={row.deliveryMode}
                  disabled={!canEdit}
                  onChange={(e) => void patch(row, { deliveryMode: e.target.value as Reply['deliveryMode'] })}
                  className="rounded-md border border-slate-200 bg-white px-1.5 py-1 !text-slate-900"
                >
                  <option value="guide">El agente la adapta al chat</option>
                  <option value="verbatim">Rápida: se manda tal cual</option>
                </select>
                {quick ? (
                  <input
                    key={`${row.id}-kw-${row.keywords.join(',')}`}
                    defaultValue={row.keywords.join(', ')}
                    placeholder="palabras: talla, medida"
                    disabled={!canEdit}
                    onBlur={(e) => {
                      const keywords = [...new Set(e.target.value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 20)
                      if (keywords.join(',') !== row.keywords.join(',')) void patch(row, { keywords })
                    }}
                    className="min-w-40 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 !text-slate-900"
                  />
                ) : null}
              </div>
              {quick && row.keywords.length === 0 ? <p className="mt-1 text-[10.5px] text-amber-800">Poné al menos una palabra para que se mande sola.</p> : null}
            </li>
          )
        })}
      </ul>

      {canEdit ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] font-medium text-slate-600">+ Nueva respuesta</summary>
          <div className="mt-2 space-y-2">
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Nombre (ej. Colores disponibles)" maxLength={60} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm !text-slate-900" />
            <textarea value={newBody} onChange={(e) => setNewBody(e.target.value)} rows={2} placeholder="Lo que le contestás al cliente" maxLength={1500} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm !text-slate-900" />
            <button type="button" disabled={busy !== null || !newTitle.trim() || !newBody.trim()} onClick={() => void create()} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              Guardar
            </button>
          </div>
        </details>
      ) : null}
    </div>
  )
}
