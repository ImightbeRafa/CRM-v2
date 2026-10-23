'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BetsyAvatar } from './betsy-avatar'
import { helpButtonPlacement } from './help-routes'
import s from './betsy-help.module.css'

/** Floating "Betsy" help entry: a plain link to /soporte (no session, no data). */
export function BetsyHelpButton() {
  const placement = helpButtonPlacement(usePathname())
  if (!placement) return null
  return (
    <Link
      href="/soporte"
      aria-label="Ayuda de Betsy"
      className={`group ${s.fab} ${placement === 'desktop' ? s.desktopOnly : ''}`}
      data-testid="betsy-help-button"
    >
      <BetsyAvatar size={30} mood="idle" motion="hover" label="" />
      <span className={s.label}>Ayuda</span>
    </Link>
  )
}
