'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { CONFIG_HUB, CONFIG_HUB_TAB, CONFIG_NAV, CONFIG_NAV_LABELS, configTabHref } from './config-nav'

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Mobile (< md) replacement for the sub-nav: sticky "Sección: <label> ▾" bar that opens a
 * sheet with Resumen + the 4 groups. Never hidden on Config pages.
 */
export function ConfigSectionSelect({ activeTab, onSelectTab }: { activeTab: string; onSelectTab?: (tab: string) => void }) {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const label = activeTab === CONFIG_HUB_TAB ? CONFIG_HUB.label : (CONFIG_NAV_LABELS[activeTab] ?? CONFIG_HUB.label)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const groups = useMemo(() => {
    const q = fold(query.trim())
    return CONFIG_NAV.map((g) => ({
      ...g,
      items: g.items.filter(
        (i) => (!i.permission || !session || hasSessionPermission(session, i.permission)) && (!q || fold(i.label).includes(q)),
      ),
    })).filter((g) => g.items.length > 0)
  }, [query, session])

  function choose(tab: string) {
    onSelectTab?.(tab)
    setOpen(false)
    setQuery('')
  }

  const rowCls = (active: boolean) =>
    `flex items-center gap-3 rounded-xl px-2 py-3 text-[14px] font-medium ${
      active ? 'bg-[#F1EEFF] text-[#5B3FE0]' : 'text-slate-800'
    }`

  return (
    <>
      <div
        data-testid="config-section-select"
        className="sticky top-0 z-20 flex h-12 shrink-0 items-center border-b border-slate-200/70 bg-white px-4 md:hidden"
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 text-left text-[14px]"
        >
          <span className="text-slate-500">Sección:</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Secciones de configuración">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.18)]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Sección</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <label className="relative mb-3 block">
              <span className="sr-only">Buscar ajuste</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar ajuste"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-[14px] text-slate-900 placeholder:text-slate-400"
              />
            </label>
            {!query.trim() && (
              <Link
                href={configTabHref(CONFIG_HUB_TAB)}
                scroll={false}
                onClick={() => choose(CONFIG_HUB_TAB)}
                aria-current={activeTab === CONFIG_HUB_TAB ? 'page' : undefined}
                className={rowCls(activeTab === CONFIG_HUB_TAB)}
              >
                <CONFIG_HUB.icon className="h-5 w-5 shrink-0" aria-hidden />
                {CONFIG_HUB.label}
              </Link>
            )}
            {groups.map((group) => (
              <div key={group.title} className="mb-1 mt-2">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
                <ul>
                  {group.items.map((item) => {
                    const Icon = item.icon
                    const active = item.tab === activeTab
                    return (
                      <li key={item.key}>
                        <Link
                          href={configTabHref(item.tab)}
                          scroll={false}
                          onClick={() => choose(item.tab)}
                          aria-current={active ? 'page' : undefined}
                          className={rowCls(active)}
                        >
                          <Icon className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
