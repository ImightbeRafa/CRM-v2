import Link from 'next/link'
import s from './betsy-logo.module.css'

export type BetsyLogoProps = {
  /** `light` surfaces (white/cream), `dark` surfaces (sidebar, landing hero) or `auto` (follows the app theme). */
  tone?: 'light' | 'dark' | 'auto'
  /** Font size in px. */
  size?: number
  /** Wrap in a link (e.g. "/", "/dashboard"). Omit for plain text. */
  href?: string
  /** Accessible name of the link (default "Betsy"). */
  ariaLabel?: string
  /** Just the "B" (collapsed sidebar). */
  mark?: boolean
  className?: string
}

/** The one Betsy wordmark: same shape everywhere, original blue→violet gradient. */
export function BetsyLogo({
  tone = 'auto',
  size = 22,
  href,
  ariaLabel,
  mark = false,
  className = '',
}: BetsyLogoProps) {
  const cls = `${s.logo} ${s[tone]} ${className}`
  const style = { fontSize: size }
  const text = mark ? 'B' : 'Betsy'
  if (!href) {
    return (
      <span className={cls} style={style}>
        {text}
      </span>
    )
  }
  return (
    <Link href={href} className={`${cls} ${s.link}`} style={style} aria-label={ariaLabel ?? (mark ? 'Betsy' : undefined)}>
      {text}
    </Link>
  )
}
