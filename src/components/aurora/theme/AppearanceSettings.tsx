'use client'

import { Palette } from 'lucide-react'
import { ConfigCard } from '@/components/aurora/config/panels/ConfigCard'
import { ThemeCards } from './ThemeChoice'

/** Config › General › Apariencia (per person and device, like the profile-menu switch). */
export function AppearanceSettings() {
  return (
    <ConfigCard className="p-5" data-testid="appearance-settings">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-au-tint-eef0ff text-au-ink-5b6cff">
          <Palette className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900">Apariencia</h2>
          <p className="text-[12.5px] text-slate-500">
            Elegí claro, oscuro o igual que tu dispositivo. Se guarda en este navegador; cada persona elige la suya.
          </p>
        </div>
      </div>
      <ThemeCards />
    </ConfigCard>
  )
}
