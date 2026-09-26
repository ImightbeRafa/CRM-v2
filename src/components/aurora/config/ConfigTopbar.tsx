import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CONFIG_HUB, CONFIG_HUB_TAB, CONFIG_NAV_LABELS } from './config-nav'

/**
 * Breadcrumb `Configuración › <panel>[ › crumb…]` (Figma top bar; global search / bell have no
 * backing feature). `trail` adds deeper crumbs (Agentes IA › <agente> › <pestaña>); the panel
 * label then becomes a link back to the panel root.
 */
export function ConfigTopbar({
  activeTab,
  trail = [],
}: {
  activeTab: string
  trail?: string[]
}) {
  const label = activeTab === CONFIG_HUB_TAB ? CONFIG_HUB.label : (CONFIG_NAV_LABELS[activeTab] ?? CONFIG_HUB.label)
  const crumbs = trail.filter(Boolean)
  const deeper = crumbs.length > 0
  return (
    <header
      data-testid="config-topbar"
      className="flex h-14 shrink-0 items-center border-b border-slate-200/70 bg-white px-4 md:px-8"
    >
      <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-[14px]">
        <Link
          href="/config"
          className={`shrink-0 text-slate-500 hover:text-slate-900 ${deeper ? 'hidden sm:inline' : ''}`}
        >
          Configuración
        </Link>
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-slate-300 ${deeper ? 'hidden sm:block' : ''}`}
          aria-hidden
        />
        {deeper ? (
          <>
            <Link
              href={`/config?tab=${encodeURIComponent(activeTab)}`}
              className="hidden shrink-0 text-slate-500 hover:text-slate-900 md:inline"
            >
              {label}
            </Link>
            <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 md:block" aria-hidden />
            {crumbs.map((crumb, i) => {
              const last = i === crumbs.length - 1
              return (
                <span key={`${i}-${crumb}`} className={`flex min-w-0 items-center gap-1.5 ${last ? '' : 'hidden sm:flex'}`}>
                  <span
                    className={`min-w-0 truncate ${last ? 'font-semibold text-[#0E0D17]' : 'text-slate-500'}`}
                    aria-current={last ? 'page' : undefined}
                  >
                    {crumb}
                  </span>
                  {last ? null : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />}
                </span>
              )
            })}
          </>
        ) : (
          <span className="min-w-0 truncate font-semibold text-[#0E0D17]" aria-current="page">
            {label}
          </span>
        )}
      </nav>
    </header>
  )
}
