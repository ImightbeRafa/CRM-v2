import { useId } from 'react'
import Link from 'next/link'
import { BETSY_COLORS, BetsyMark, type BetsyMarkProps } from './BetsyMark'
import { BETSY_WORDMARK_BOX, BETSY_WORDMARK_GRADIENT_X2, BETSY_WORDMARK_PATH } from './betsy-wordmark'
import s from './betsy-logo.module.css'

export type BetsyLogoProps = {
  /**
   * Gradient on every surface (the official wordmark reads on dark and cream alike); `light` /
   * `dark` / `auto` are accepted for older call sites. `mono-white` / `mono-ink` for one-color use.
   */
  tone?: 'light' | 'dark' | 'auto' | 'mono-white' | 'mono-ink'
  /** Height of the wordmark in px (about the old font size). */
  size?: number
  /** Mark + wordmark (official lockup proportions). */
  lockup?: boolean
  /** Just the mark (collapsed rail). */
  mark?: boolean
  /** Lockup / mark only: let the mark breathe and blink (default still). */
  animated?: boolean
  /** Lockup / mark only: live state for the mark (e.g. from `useBetsyPresence`). */
  markState?: Pick<BetsyMarkProps, 'state' | 'level' | 'readSignal'>
  /** Wrap in a link (e.g. "/", "/dashboard"). Omit for plain content. */
  href?: string
  /** Accessible name (default "Betsy"). */
  ariaLabel?: string
  className?: string
}

function Wordmark({ height, tone }: { height: number; tone: BetsyLogoProps['tone'] }) {
  const gid = `bwg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { x, y, w, h } = BETSY_WORDMARK_BOX
  const fill = tone === 'mono-white' ? '#FFFFFF' : tone === 'mono-ink' ? BETSY_COLORS.ink : `url(#${gid})`
  return (
    <svg
      className={s.word}
      viewBox={`${x} ${y} ${w} ${h}`}
      height={height}
      width={(height * w) / h}
      aria-hidden="true"
      focusable="false"
    >
      {fill.startsWith('url') ? (
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={BETSY_WORDMARK_GRADIENT_X2} y2="0">
            <stop offset="0" stopColor={BETSY_COLORS.blue} />
            <stop offset=".5" stopColor={BETSY_COLORS.mid} />
            <stop offset="1" stopColor={BETSY_COLORS.violet} />
          </linearGradient>
        </defs>
      ) : null}
      <path d={BETSY_WORDMARK_PATH} fill={fill} />
    </svg>
  )
}

/** The one Betsy logo: the official outlined wordmark, optionally with the mark (lockup). */
export function BetsyLogo({
  tone = 'auto',
  size = 22,
  lockup = false,
  mark = false,
  animated = false,
  markState,
  href,
  ariaLabel = 'Betsy',
  className = '',
}: BetsyLogoProps) {
  const markTone = tone === 'mono-white' || tone === 'mono-ink' ? tone : 'dark'
  // Inside a logo the typing dots would push the wordmark (layout shift): show the think light instead.
  const live = markState?.state === 'typing' ? { ...markState, state: 'think' as const } : markState
  // Lockup proportions (HANDOFF.md): mark box = 1.8 × wordmark height, gap = 0.24 × mark height.
  const markSize = mark ? Math.round(size * 1.25) : Math.round(size * 1.8)
  const content = mark ? (
    <BetsyMark size={markSize} tone={markTone} animated={animated} decorative {...live} />
  ) : lockup ? (
    <>
      <BetsyMark size={markSize} tone={markTone} animated={animated} decorative {...live} />
      <span className={s.lockWord} style={{ marginLeft: Math.round(markSize * 0.24) }}>
        <Wordmark height={size} tone={tone} />
      </span>
    </>
  ) : (
    <Wordmark height={size} tone={tone} />
  )
  const cls = `${s.logo} ${className}`
  if (!href) {
    return (
      <span className={cls} role="img" aria-label={ariaLabel}>
        {content}
      </span>
    )
  }
  return (
    <Link href={href} className={`${cls} ${s.link}`} aria-label={ariaLabel}>
      {content}
    </Link>
  )
}
