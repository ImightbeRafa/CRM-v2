'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { Search } from 'lucide-react'
import { AuroraBell } from './AuroraBell'

const AuroraCommandPalette = dynamic(() => import('./AuroraCommandPalette').then((m) => m.AuroraCommandPalette), {
  ssr: false,
})

/**
 * Right side of every Aurora page header: ⌘K search trigger (desktop) + notifications bell.
 * On mobile the bell shows at every width; search lives on ⌘K / desktop only.
 */
export function AuroraTopActions() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-9 w-[200px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-[13px] text-slate-400 transition-colors hover:bg-slate-50 lg:flex"
        aria-label="Buscar (⌘K)"
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Buscar…</span>
        <kbd className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 md:flex lg:hidden"
        aria-label="Buscar"
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
      <AuroraBell />
      {paletteOpen ? <AuroraCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} /> : null}
    </div>
  )
}
