'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { CONFIG_HUB, CONFIG_HUB_TAB, CONFIG_NAV, configTabHref, type ConfigNavItem } from './config-nav'
import { useChannelsNeedingAction } from './useChannelsNeedingAction'

type ConfigSubNavProps = {
  activeTab: string
  /** Optimistic highlight before the URL settles; navigation itself is done by the Link. */
  onSelectTab?: (tab: string) => void
  /** Show the needs-action count badge on "Cuentas conectadas" (only where the user may see channels). */
  showChannelsBadge?: boolean
}

const itemBase =
  'flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[13px] font-medium transition-colors'

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function ChannelsBadge() {
  const count = useChannelsNeedingAction()
  if (count < 1) return null
  return (
    <span
      data-testid="config-subnav-channels-badge"
      aria-label={`${count} ${count === 1 ? 'canal requiere' : 'canales requieren'} acción`}
      className="ml-auto flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700"
    >
      {count}
    </span>
  )
}

function NavLink({
  tab,
  label,
  Icon,
  active,
  onSelectTab,
  badge,
}: {
  tab: string
  label: string
  Icon: ConfigNavItem['icon']
  active: boolean
  onSelectTab?: (tab: string) => void
  badge?: boolean
}) {
  return (
    <Link
      href={configTabHref(tab as never)}
      scroll={false}
      onClick={() => onSelectTab?.(tab)}
      aria-current={active ? 'page' : undefined}
      className={`${itemBase} ${
        active
          ? 'bg-[#F1EEFF] text-[#3F2BB8]'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#5B3FE0]' : 'text-slate-400'}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <ChannelsBadge /> : null}
    </Link>
  )
}

/** Persistent Config sub-nav (desktop): Resumen + Negocio / Comunicación / Operación / Cuenta. */
export function ConfigSubNav({ activeTab, onSelectTab, showChannelsBadge = true }: ConfigSubNavProps) {
  const { data: session } = useSession()
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = fold(query.trim())
    return CONFIG_NAV.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.permission && session && !hasSessionPermission(session, item.permission)) return false
        return !q || fold(item.label).includes(q)
      }),
    })).filter((g) => g.items.length > 0)
  }, [query, session])

  const showHub = !query.trim() || fold(CONFIG_HUB.label).includes(fold(query.trim()))

  return (
    <nav
      aria-label="Configuración"
      className="hidden w-[252px] shrink-0 flex-col overflow-y-auto border-r border-slate-200/70 bg-white px-3 py-4 md:flex"
      data-testid="config-subnav"
    >
      <label className="relative mb-4 block">
        <span className="sr-only">Buscar ajuste</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ajuste"
          className="w-full rounded-[10px] border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-[#5B3FE0] focus:outline-none focus:ring-2 focus:ring-[#5B3FE0]/20"
        />
      </label>

      {showHub && (
        <div className="mb-4">
          <NavLink
            tab={CONFIG_HUB_TAB}
            label={CONFIG_HUB.label}
            Icon={CONFIG_HUB.icon}
            active={activeTab === CONFIG_HUB_TAB}
            onSelectTab={onSelectTab}
          />
        </div>
      )}

      {groups.map((group) => (
        <div key={group.title} className="mb-4">
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{group.title}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.key}>
                <NavLink
                  tab={item.tab}
                  label={item.label}
                  Icon={item.icon}
                  active={item.tab === activeTab}
                  onSelectTab={onSelectTab}
                  badge={item.tab === 'social' && showChannelsBadge}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}

      {!showHub && groups.length === 0 && (
        <p className="px-3 text-[12px] text-slate-400">Sin resultados para “{query}”.</p>
      )}
    </nav>
  )
}
