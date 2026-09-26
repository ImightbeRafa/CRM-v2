'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, CornerDownLeft } from 'lucide-react'
import { AuroraModal } from '@/components/aurora/ui/AuroraModal'
import { AURORA_NAV } from '@/components/aurora/aurora-nav'
import { CONFIG_NAV } from '@/components/aurora/config/config-nav'
import { auroraInputClass } from '@/components/aurora/ui/aurora-form'
import { buildPaletteItems, filterPaletteItems, type PaletteItem } from '@/lib/aurora-palette'
import { useAuroraViewer } from './useAuroraViewer'

/**
 * ⌘K palette. Lists only real destinations (sidebar pages, Config tabs, "Crear pedido") plus a
 * "Buscar pedidos" hand-off to the Pedidos search. It never fakes client / chat results.
 */
export function AuroraCommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const viewer = useAuroraViewer()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const items = useMemo(
    () =>
      filterPaletteItems(
        buildPaletteItems({
          nav: AURORA_NAV,
          configNav: CONFIG_NAV,
          isAdmin: viewer.isAdmin,
          canViewSales: viewer.can('view_sales'),
          canCreateSales: viewer.can('create_sales'),
          canViewConfig: viewer.can('view_config'),
        }),
        query,
        viewer.can('view_sales'),
      ),
    [query, viewer],
  )

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
    }
  }, [open])
  useEffect(() => setActive(0), [query])

  const go = (item: PaletteItem) => {
    onOpenChange(false)
    router.push(item.href)
  }

  return (
    <AuroraModal open={open} onOpenChange={onOpenChange} title="Buscar" description="Ir a una sección o buscar un pedido." size="sm">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(items.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault()
              go(items[active])
            }
          }}
          placeholder="Buscar pedidos o ir a…"
          aria-label="Buscar"
          className={`${auroraInputClass} pl-9`}
        />
      </div>
      <ul className="mt-3 space-y-0.5" role="listbox" aria-label="Resultados">
        {items.map((item, i) => {
          const Icon = item.kind === 'create' ? Plus : item.kind === 'search' ? Search : item.icon
          return (
            <li key={item.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => go(item)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left text-[13px] ${
                  i === active ? 'bg-[#F1EEFF] text-[#4B36B8]' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint ? <span className="shrink-0 text-[11px] text-slate-400">{item.hint}</span> : null}
                {i === active ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden /> : null}
              </button>
            </li>
          )
        })}
        {items.length === 0 ? <li className="px-2.5 py-6 text-center text-[13px] text-slate-500">Sin resultados</li> : null}
      </ul>
    </AuroraModal>
  )
}
