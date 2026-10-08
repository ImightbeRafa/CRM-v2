'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatColones, type CatalogItem } from '@/lib/chat-catalog'

type Mapped = { id: string; name: string; sku: string | null; sellingPrice: number; currentStock: number; isActive: boolean }

/** Which products this agent may quote. Empty = none (fail closed: one business can run several stores). */
export function AgentInventoryCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [available, setAvailable] = useState(true)
  const [items, setItems] = useState<Mapped[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogItem[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { available?: boolean; items?: Mapped[] }
      setAvailable(json.available !== false)
      setItems(json.items ?? [])
    } catch {
      /* optional card */
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/chat/catalog?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
          if (!res.ok) return
          const json = (await res.json()) as { items?: CatalogItem[] }
          if (!cancelled) setResults(json.items ?? [])
        } catch {
          /* ignore */
        }
      })()
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  async function save(next: string[]) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: next }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo guardar.')
      await load()
    } catch {
      setMessage('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }

  if (items === null) return null
  const ids = items.map((i) => i.id)
  return (
    <div className="mt-4 rounded-lg bg-slate-50 p-3" data-testid="agent-inventory-card">
      <p className="text-[13px] font-semibold text-slate-900">Productos que puede cotizar</p>
      {!available ? (
        <p className="mt-1 text-[12px] text-slate-500">Se activa con la próxima actualización.</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-slate-500">
            {items.length === 0
              ? 'Sin productos: el agente no puede cotizar nada todavía. Agregá los productos que vende este canal.'
              : 'El agente solo busca y cotiza estos productos. Precio y stock siempre salen del inventario en vivo.'}
          </p>
          {items.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-[12.5px] text-slate-800">
                  <span className="min-w-0 truncate">
                    {i.name}
                    {!i.isActive ? ' (inactivo)' : ''} · {formatColones(i.sellingPrice)}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void save(ids.filter((x) => x !== i.id))}
                      className="shrink-0 text-[11.5px] text-red-600 hover:underline disabled:opacity-40"
                    >
                      Quitar
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit ? (
            <div className="mt-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar producto para agregar…"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] text-slate-900"
                aria-label="Buscar producto"
              />
              {results.length > 0 ? (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
                  {results
                    .filter((r) => !ids.includes(r.id))
                    .map((r) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setQ('')
                            setResults([])
                            void save([...ids, r.id])
                          }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-slate-50 disabled:opacity-40"
                        >
                          <span className="min-w-0 truncate">{r.name}</span>
                          <span className="shrink-0 text-slate-500">{formatColones(r.sellingPrice)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {message ? <p className="mt-2 text-[12px] text-red-700">{message}</p> : null}
        </>
      )}
    </div>
  )
}
