'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatColones } from '@/lib/chat-catalog'
import { BACK_NOTE_MAX, crToday, MAX_BACK_DAYS } from '@/lib/soft-ai/product-availability-core'

type Mapped = {
  id: string
  name: string
  sku: string | null
  sellingPrice: number
  currentStock: number
  isActive: boolean
  /** SQL 055: the owner's "Agotado" switch, the stock-0 rule (stores that track stock) and the "vuelve aprox.". */
  soldOut?: boolean
  autoSoldOut?: boolean
  backDate?: string | null
  backNote?: string | null
  backExpired?: boolean
}
type Availability = { soldOut: boolean; backDate: string | null; backNote: string | null }

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * Out-of-stock switch per product (Rafael 2026-10-18). Store-level: every agent of this store sees it. A product is
 * also sold out on its own when its stock is 0 (stores that track stock). Each change saves at once and is audited.
 */
function AvailabilityList({ agentId, items, canEdit, onSaved }: { agentId: string; items: Mapped[]; canEdit: boolean; onSaved: () => Promise<void> }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [dates, setDates] = useState<Record<string, string>>({})
  const today = crToday()
  const maxDay = addDays(today, MAX_BACK_DAYS)

  async function patch(itemId: string, next: Availability) {
    setBusyId(itemId)
    setError(null)
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...next }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setError(json.error || 'No se pudo guardar.')
      await onSaved()
      // The saved value is shown from the server now (a stale draft never comes back after "Disponible").
      setNotes(({ [itemId]: _drop, ...rest }) => rest)
      setDates(({ [itemId]: _drop, ...rest }) => rest)
    } catch {
      setError('No se pudo guardar. Intentá de nuevo.')
    } finally {
      setBusyId(null)
    }
  }

  const active = items.filter((i) => i.isActive)
  if (active.length === 0) return null
  return (
    <div className="mt-3 rounded-xl p-3 ring-1 ring-slate-200/70" data-testid="agent-availability">
      <p className="text-[13px] font-medium text-slate-800">¿Hay stock?</p>
      <p className="mt-0.5 text-[11.5px] text-slate-500">
        Marcá «Agotado» y el agente no lo ofrece ni toma el pedido: lo dice claro, ofrece otro disponible y no inventa fechas.
        Cambia para todos los agentes de esta tienda.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">
        {active.map((i) => {
          const out = Boolean(i.soldOut || i.autoSoldOut)
          const busy = busyId === i.id
          // An expired date is never sent back (the server would refuse it and the owner could not clear it).
          const liveDate = i.backExpired ? null : (i.backDate ?? null)
          const current: Availability = { soldOut: Boolean(i.soldOut), backDate: liveDate, backNote: i.backNote ?? null }
          const noteDraft = notes[i.id] ?? i.backNote ?? ''
          const dateDraft = dates[i.id] ?? liveDate ?? ''
          const saveDate = () => {
            if (dateDraft === (liveDate ?? '')) return
            // Typing a year key by key gives "0002-…" for a moment: only a full date in range is saved (on blur).
            if (dateDraft && (dateDraft < today || dateDraft > maxDay)) {
              setError('La fecha de regreso tiene que ser de hoy a 6 meses.')
              return
            }
            void patch(i.id, { ...current, backDate: dateDraft || null, backNote: dateDraft ? null : current.backNote })
          }
          return (
            <li key={i.id} className="py-2" data-testid="agent-availability-row">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate text-slate-800">{i.name}</span>
                <span className="shrink-0 text-slate-500">stock {i.currentStock}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={out}
                  aria-label={`Agotado: ${i.name}`}
                  disabled={!canEdit || busy || Boolean(i.autoSoldOut && !i.soldOut)}
                  title={i.autoSoldOut ? 'Agotado porque el stock está en 0. Se quita solo cuando vuelva a haber stock.' : undefined}
                  // Both ways start clean: an old "vuelve aprox." never comes back with a new outage.
                  onClick={() => void patch(i.id, { soldOut: !i.soldOut, backDate: null, backNote: null })}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium disabled:cursor-not-allowed ${
                    out ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                  } ${busy ? 'opacity-50' : ''}`}
                >
                  {out ? (i.autoSoldOut && !i.soldOut ? 'Agotado (stock 0)' : 'Agotado') : 'Disponible'}
                </button>
              </div>
              {out ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1 text-[12px] text-slate-600">
                  <label className="flex items-center gap-1.5">
                    Vuelve aprox.
                    <input
                      type="date"
                      value={dateDraft}
                      min={today}
                      max={maxDay}
                      disabled={!canEdit || busy}
                      onChange={(e) => setDates((d) => ({ ...d, [i.id]: e.target.value }))}
                      onBlur={saveDate}
                      className="rounded-lg border border-slate-200 px-2 py-0.5 text-[12px]"
                    />
                  </label>
                  {!liveDate ? (
                    <input
                      type="text"
                      value={noteDraft}
                      maxLength={BACK_NOTE_MAX}
                      placeholder="o una nota sin números: la próxima semana"
                      aria-label={`Nota de regreso: ${i.name}`}
                      disabled={!canEdit || busy}
                      onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                      onBlur={() => {
                        if (noteDraft.trim() !== (i.backNote ?? '')) void patch(i.id, { ...current, backNote: noteDraft.trim() || null })
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-0.5 text-[12px]"
                    />
                  ) : null}
                  {i.backExpired ? (
                    <span className="w-full text-[11.5px] text-amber-700">La fecha ya pasó: el agente dice que todavía no hay fecha.</span>
                  ) : !i.backDate && !i.backNote ? (
                    <span className="w-full text-[11.5px] text-slate-500">Sin fecha: el agente dice que todavía no hay fecha de regreso.</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {error ? <p className="mt-1 text-[12px] text-red-700">{error}</p> : null}
    </div>
  )
}
type Group = { category: string; items: Array<{ id: string; name: string; sku: string | null; sellingPrice: number; currentStock: number }> }

/**
 * Which products this agent may sell, picked by group (inventory category: e.g. "ARNESS" = all sizes) or one by
 * one. Empty = none (fail closed: one business can run several stores). Price and stock always come from inventory.
 */
export function AgentInventoryCard({ agentId, canEdit, title }: { agentId: string; canEdit: boolean; title?: string }) {
  const [available, setAvailable] = useState(true)
  const [stockSwitch, setStockSwitch] = useState(false)
  const [items, setItems] = useState<Mapped[] | null>(null)
  const [catalog, setCatalog] = useState<Group[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/inventory?catalog=1`, { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { available?: boolean; availabilityReady?: boolean; items?: Mapped[]; catalog?: Group[] }
      setAvailable(json.available !== false)
      setStockSwitch(json.availabilityReady === true)
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
          {stockSwitch ? <AvailabilityList agentId={agentId} items={items} canEdit={canEdit} onSaved={load} /> : null}
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
