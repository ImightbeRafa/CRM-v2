'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BetsyMark } from './BetsyMark'
import { helpButtonPlacement } from './help-routes'
import s from './betsy-help.module.css'

/** Floating "Betsy" help entry: a plain link to /soporte (no session, no data). The mark listens on hover. */
export function BetsyHelpButton() {
  const placement = helpButtonPlacement(usePathname())
  const [hover, setHover] = useState(false)
  if (!placement) return null
  return (
    <Link
      href="/soporte"
      aria-label="Ayuda de Betsy"
      className={s.fab}
      data-testid="betsy-help-button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <BetsyMark size={30} state={hover ? 'listen' : 'idle'} decorative />
      <span className={s.label}>Ayuda</span>
    </Link>
  )
}
