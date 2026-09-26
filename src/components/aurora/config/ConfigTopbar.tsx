import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { CONFIG_HUB, CONFIG_HUB_TAB, CONFIG_NAV_LABELS } from './config-nav'

/** Breadcrumb `Configuración › <panel>` (Figma top bar; global search / bell have no backing feature). */
export function ConfigTopbar({ activeTab }: { activeTab: string }) {
  const label = activeTab === CONFIG_HUB_TAB ? CONFIG_HUB.label : (CONFIG_NAV_LABELS[activeTab] ?? CONFIG_HUB.label)
  return (
    <header
      data-testid="config-topbar"
      className="flex h-14 shrink-0 items-center border-b border-slate-200/70 bg-white px-4 md:px-8"
    >
      <nav aria-label="Ruta" className="flex min-w-0 items-center gap-1.5 text-[14px]">
        <Link href="/config" className="shrink-0 text-slate-500 hover:text-slate-900">
          Configuración
        </Link>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />
        <span className="min-w-0 truncate font-semibold text-[#0E0D17]" aria-current="page">
          {label}
        </span>
      </nav>
    </header>
  )
}
