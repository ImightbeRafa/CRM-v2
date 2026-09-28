'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'

export type ThemeMode = 'system' | 'light' | 'dark'

export const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; hint: string; icon: LucideIcon }> = [
  { id: 'system', label: 'Sistema', hint: 'Igual que tu dispositivo', icon: Monitor },
  { id: 'light', label: 'Claro', hint: 'Fondo claro', icon: Sun },
  { id: 'dark', label: 'Oscuro', hint: 'Fondo oscuro', icon: Moon },
]

/** Current theme choice (null until mounted: next-themes reads localStorage on the client). */
export function useThemeChoice(): { mode: ThemeMode | null; setMode: (m: ThemeMode) => void; resolved: 'light' | 'dark' | null } {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const mode = mounted ? ((theme as ThemeMode) || 'system') : null
  return {
    mode,
    setMode: (m) => setTheme(m),
    resolved: mounted ? (resolvedTheme === 'dark' ? 'dark' : 'light') : null,
  }
}

/** Compact segmented control (profile menu). */
export function ThemeSegmented({ className = '' }: { className?: string }) {
  const { mode, setMode } = useThemeChoice()
  return (
    <div role="radiogroup" aria-label="Tema" className={`flex rounded-xl bg-slate-100 p-0.5 ${className}`}>
      {THEME_OPTIONS.map((opt) => {
        const active = mode === opt.id
        const Icon = opt.icon
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(opt.id)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-[10px] px-2 py-1.5 text-[11.5px] font-medium transition ${
              active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/70' : 'text-slate-500 hover:text-slate-800'
            }`}
            data-testid={`theme-${opt.id}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/** Mini preview of the app chrome in a given theme (always drawn in that theme's colors). */
function ThemePreview({ mode }: { mode: ThemeMode }) {
  const light = (
    <div className="flex h-full w-full overflow-hidden">
      <div className="w-1/4 bg-[#0E0D17]" />
      <div className="flex-1 space-y-1.5 p-2" style={{ background: '#F7F6F3' }}>
        <div className="h-2 w-2/3 rounded-full" style={{ background: '#CBD5E1' }} />
        <div className="h-5 rounded-md" style={{ background: '#FFFFFF', boxShadow: '0 0 0 1px #E2E8F0' }} />
        <div className="h-5 rounded-md" style={{ background: '#FFFFFF', boxShadow: '0 0 0 1px #E2E8F0' }} />
      </div>
    </div>
  )
  const dark = (
    <div className="flex h-full w-full overflow-hidden">
      <div className="w-1/4 bg-[#07070C]" />
      <div className="flex-1 space-y-1.5 p-2" style={{ background: '#0D0D14' }}>
        <div className="h-2 w-2/3 rounded-full" style={{ background: '#3A3A4D' }} />
        <div className="h-5 rounded-md" style={{ background: '#16161F', boxShadow: '0 0 0 1px #262635' }} />
        <div className="h-5 rounded-md" style={{ background: '#16161F', boxShadow: '0 0 0 1px #262635' }} />
      </div>
    </div>
  )
  if (mode === 'light') return light
  if (mode === 'dark') return dark
  return (
    <div className="relative h-full w-full">
      {light}
      <div className="absolute inset-0" style={{ clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
        {dark}
      </div>
    </div>
  )
}

/** Config › General › Apariencia: large cards with previews. */
export function ThemeCards() {
  const { mode, setMode } = useThemeChoice()
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {THEME_OPTIONS.map((opt) => {
        const active = mode === opt.id
        const Icon = opt.icon
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(opt.id)}
            className={`group overflow-hidden rounded-2xl text-left ring-1 transition ${
              active ? 'ring-2 ring-[#5B6CFF]' : 'ring-slate-200/80 hover:ring-slate-300'
            }`}
            data-testid={`theme-card-${opt.id}`}
          >
            <div className="h-20 w-full">
              <ThemePreview mode={opt.id} />
            </div>
            <div className="flex items-center gap-2.5 bg-white px-3.5 py-3">
              <Icon className={`h-4 w-4 ${active ? 'text-[#5B6CFF]' : 'text-slate-500'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-slate-900">{opt.label}</span>
                <span className="block text-[11.5px] text-slate-500">{opt.hint}</span>
              </span>
              <span
                className={`h-4 w-4 shrink-0 rounded-full ring-1 ${active ? 'bg-[#5B6CFF] ring-[#5B6CFF] shadow-[inset_0_0_0_3px_#fff]' : 'ring-slate-300'}`}
                aria-hidden
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}
