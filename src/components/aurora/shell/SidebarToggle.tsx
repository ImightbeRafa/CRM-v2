'use client'

import { ChevronsLeft, ChevronsRight } from 'lucide-react'

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-au-sidebar'

/** Collapse / expand the Aurora sidebar (its own file so the sidebar itself stays links only). */
export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? ChevronsRight : ChevronsLeft
  const label = collapsed ? 'Expandir menú' : 'Contraer menú'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      aria-expanded={!collapsed}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-static-white/10 hover:text-white ${FOCUS_RING}`}
      data-testid="sidebar-toggle"
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  )
}
