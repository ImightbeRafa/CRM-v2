'use client'

import Link from 'next/link'
import { CONFIG_NAV, CONFIG_HUB_TAB, type ConfigNavItem } from './config-nav'

type ConfigSubNavProps = {
  activeTab: string
  onSelectTab: (tab: string) => void
}

const itemBase =
  'flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium transition-colors'

function NavItem({ item, active, onSelectTab }: { item: ConfigNavItem; active: boolean; onSelectTab: (t: string) => void }) {
  const Icon = item.icon
  const cls = `${itemBase} ${
    active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-600 hover:bg-white/70'
  }`
  const inner = (
    <>
      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#5B6CFF]' : 'text-slate-400'}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
    </>
  )
  if (item.href) {
    return (
      <Link href={item.href} className={cls}>
        {inner}
      </Link>
    )
  }
  return (
    <button type="button" onClick={() => onSelectTab(item.tab!)} aria-current={active ? 'page' : undefined} className={cls}>
      {inner}
    </button>
  )
}

/** Desktop: grouped left column (Negocio / Comunicación / Operación / Cuenta). Mobile: horizontal pills. */
export function ConfigSubNav({ activeTab, onSelectTab }: ConfigSubNavProps) {
  return (
    <>
      <nav aria-label="Configuración" className="hidden w-[220px] shrink-0 md:block" data-testid="config-subnav">
        <button
          type="button"
          onClick={() => onSelectTab(CONFIG_HUB_TAB)}
          className={`mb-4 ${itemBase} ${
            activeTab === CONFIG_HUB_TAB
              ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70'
              : 'text-slate-600 hover:bg-white/70'
          }`}
        >
          Resumen
        </button>
        {CONFIG_NAV.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <NavItem item={item} active={item.tab === activeTab} onSelectTab={onSelectTab} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="-mx-4 overflow-x-auto px-4 md:hidden">
        <div className="flex min-w-max gap-2 pb-2">
          {[{ key: CONFIG_HUB_TAB, label: 'Resumen', tab: CONFIG_HUB_TAB, href: undefined }, ...CONFIG_NAV.flatMap((g) => g.items)].map(
            (item) => {
              const active = item.tab === activeTab
              const cls = `whitespace-nowrap rounded-full px-3.5 py-2 text-xs font-medium ${
                active ? 'bg-[#5B6CFF] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200/70'
              }`
              return item.href ? (
                <Link key={item.key} href={item.href} className={cls}>
                  {item.label}
                </Link>
              ) : (
                <button key={item.key} type="button" onClick={() => onSelectTab(item.tab!)} className={cls}>
                  {item.label}
                </button>
              )
            },
          )}
        </div>
      </div>
    </>
  )
}
