'use client'

import { useEffect, useRef, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { formatCatalogSnippet, stockPhrase, formatColones, type CatalogItem } from '@/lib/chat-catalog'

/** Pick a product and insert "Nombre — ₡precio" into the message (the person edits and sends). */
export function CatalogPicker({
  onPick,
  onClose,
}: {
  onPick: (snippet: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [failed, setFailed] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Escape or a click outside closes it (like the emoji picker).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      // The toggle button handles its own click (otherwise it would close and immediately reopen).
      if (target?.closest?.('[data-popover-toggle]')) return
      if (rootRef.current && !rootRef.current.contains(target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/chat/catalog?q=${encodeURIComponent(q)}`, {
            credentials: 'same-origin',
            cache: 'no-store',
          })
          if (!res.ok) throw new Error(String(res.status))
          const json = (await res.json()) as { items?: CatalogItem[] }
          if (!cancelled) {
            setItems(json.items ?? [])
            setFailed(false)
          }
        } catch {
          if (!cancelled) setFailed(true)
        }
      })()
    }, q ? 250 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [q])

  return (
    <div
      ref={rootRef}
      className="aurora-light text-slate-900 absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200"
      data-testid="composer-catalog"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <ShoppingBag className="h-3 w-3" aria-hidden /> Catálogo
        </p>
        <button type="button" onClick={onClose} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">
          Cerrar
        </button>
      </div>
      <div className="border-b border-slate-100 px-3 py-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar producto o código…"
          className="w-full rounded-lg border border-slate-200 px-3 py-1.5 text-[13px] text-slate-900 outline-none focus:border-[#7C5CFF]"
          aria-label="Buscar en el catálogo"
        />
      </div>
      {failed ? (
        <p className="px-3 py-4 text-[12px] text-red-700">No se pudo cargar el catálogo.</p>
      ) : items === null ? (
        <p className="px-3 py-4 text-[12px] text-slate-500">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-slate-500">No hay productos con ese nombre.</p>
      ) : (
        <ul className="max-h-64 overflow-y-auto py-1" aria-label="Productos">
          {items.map((item) => {
            const stock = stockPhrase(item)
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onPick(formatCatalogSnippet(item))}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-900">{item.name}</span>
                  <span className="shrink-0 text-[12px] font-semibold text-slate-700">
                    {formatColones(item.sellingPrice)}
                  </span>
                  {stock ? (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-800 ring-1 ring-amber-200">
                      {stock}
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-3 py-1.5 text-[10.5px] text-slate-400">
        Inserta el texto en el mensaje: lo revisás y lo enviás vos.
      </p>
    </div>
  )
}
