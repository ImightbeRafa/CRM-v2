'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatColones } from '@/lib/chat-catalog'

type Mapped = { id: string; name: string; sku: string | null; sellingPrice: number; currentStock: number; isActive: boolean }
type Group = { category: string; items: Array<{ id: string; name: string; sku: string | null; sellingPrice: number; currentStock: number }> }

/**
 * Which products this agent may sell, picked by group (inventory category: e.g. "ARNESS" = all sizes) or one by
 * one. Empty = none (fail closed: one business can run several stores). Price and stock always come from inventory.
 */
export function AgentInventoryCard({ agentId, canEdit, title }: { agentId: string; canEdit: boolean; title?: string }) {
  const [available, setAvailable] = useState(true)
  const [items, setItems] = useState<Mapped[] | null>(null)
  const [catalog, setCatalog] = useState<Group[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory?catalog=1`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { available?: boolean; items?: Mapped[]; catalog?: Group[] }
      setAvailable(json.available !== false)
      setItems(json.items ?? [])
      setCatalog(json.catalog ?? [])
    } catch {
      /* optional card */
    }
  }, [agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: string[]) {
    setBusy(true)
    setMessage(null)
    if (new Set(next).size > 200) setMessage('Un agente puede vender hasta 200 productos: se guardaron los primeros 200.')
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIds: [...new Set(next)].slice(0, 200) }),
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
  const selected = new Set(items.map((i) => i.id))
  const ids = [...selected]

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5" data-testid="agent-inventory-card">
      <p className="text-[14px] font-semibold text-slate-900">{title || 'Productos que puede vender'}</p>
      {!available ? (
        <p className="mt-1 text-[12px] text-slate-500">Se activa con la próxima actualización.</p>
      ) : (
        <>
          <p className={`mt-1 text-[12px] ${items.length === 0 ? 'font-medium text-red-700' : 'text-slate-500'}`}>
            {items.length === 0
              ? '0 productos: este agente no puede vender nada. Elegí un grupo abajo.'
              : `${items.length} producto(s). Precio y stock siempre salen del inventario en vivo.`}
          </p>
          {catalog.length === 0 ? (
            <p className="mt-2 text-[12px] text-slate-500">Este negocio no tiene productos activos en el inventario.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200/70">
              {catalog.map((g) => {
                const inGroup = g.items.filter((i) => selected.has(i.id)).length
                const all = inGroup === g.items.length
                return (
                  <li key={g.category} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpen(open === g.category ? null : g.category)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        aria-expanded={open === g.category}
                      >
                        <span aria-hidden className="text-slate-400">{open === g.category ? '▾' : '▸'}</span>
                        <span className="truncate text-[13px] font-medium text-slate-800">{g.category}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${inGroup ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {inGroup}/{g.items.length}
                        </span>
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void save(all ? ids.filter((x) => !g.items.some((i) => i.id === x)) : [...ids, ...g.items.map((i) => i.id)])
                          }
                          className={`shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium disabled:opacity-40 ${
                            all ? 'text-red-600 hover:bg-red-50' : 'bg-[#5B6CFF] text-white'
                          }`}
                        >
                          {all ? 'Quitar todo' : 'Agregar todo'}
                        </button>
                      ) : null}
                    </div>
                    {open === g.category ? (
                      <ul className="mt-2 space-y-1 pl-6">
                        {g.items.map((i) => (
                          <li key={i.id}>
                            <label className="flex items-center gap-2 text-[12.5px] text-slate-800">
                              <input
                                type="checkbox"
                                checked={selected.has(i.id)}
                                disabled={!canEdit || busy}
                                onChange={(e) => void save(e.target.checked ? [...ids, i.id] : ids.filter((x) => x !== i.id))}
                                className="h-4 w-4 accent-[#5B6CFF]"
                              />
                              <span className="min-w-0 flex-1 truncate">{i.name}</span>
                              <span className="shrink-0 text-slate-500">
                                {formatColones(i.sellingPrice)} · stock {i.currentStock}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {(() => {
            // Chosen products not shown in the groups above (inactive, or beyond the list): still removable here.
            const listed = new Set(catalog.flatMap((g) => g.items.map((i) => i.id)))
            const others = items.filter((i) => !listed.has(i.id))
            if (!others.length) return null
            return (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-100">
                <p className="text-[12px] font-medium text-amber-900">Otros elegidos (inactivos o fuera de la lista)</p>
                <ul className="mt-1 space-y-1">
                  {others.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 text-[12px] text-amber-900">
                      <span className="min-w-0 truncate">
                        {i.name}
                        {!i.isActive ? ' (inactivo)' : ''}
                      </span>
                      {canEdit ? (
                        <button type="button" disabled={busy} onClick={() => void save(ids.filter((x) => x !== i.id))} className="shrink-0 text-red-600 hover:underline disabled:opacity-40">
                          Quitar
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
          {message ? <p className="mt-2 text-[12px] text-red-700">{message}</p> : null}
        </>
      )}
    </div>
  )
}
