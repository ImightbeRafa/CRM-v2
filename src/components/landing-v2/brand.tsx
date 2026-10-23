import { Sparkles } from 'lucide-react'
import s from './landing.module.css'

/**
 * Brand slots for the home: the ONLY place landing-v2 renders Betsy's logo or mark.
 * Lane I is turning docs/design/betsy-mascot-handoff into `BetsyMark` (chat-tail bubble with eyes, gradient
 * #2F6BFF→#5644E4→#7A3FF0, states idle / listen / think / typing / speak / yes / paused) and `BetsyLogo` (lockups)
 * in src/components/brand/. When they land, `Logo` and `Mark` below each become one import; nothing else changes.
 *
 * Handoff rules applied here: one mark per view, never the hero over product UI (so the hero has no mascot; the
 * mark lives inside the demo's status bar and does the "yes" hop at "Pago verificado"), gaze at the content/CTA,
 * the mark is never recolored (agent "costumes" color the plate behind it, not the mark).
 */

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return <span className={`${s.logo} ${tone === 'light' ? s.logoOnLight : ''}`}>Betsy</span>
}

export type MarkState = 'idle' | 'listen' | 'think' | 'typing' | 'speak' | 'yes' | 'paused'

/**
 * Betsy's mark. Placeholder until `BetsyMark` lands: a neutral sparkle on the brand gradient, same box size, so
 * swapping it causes no layout shift. `state` is passed through for the real component.
 */
export function Mark({ size = 32, state = 'idle', decorative = true }: { size?: number; state?: MarkState; decorative?: boolean }) {
  return (
    <span
      className={s.markSlot}
      data-state={state}
      style={{ width: size, height: size }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Betsy'}
      aria-hidden={decorative ? true : undefined}
    >
      <Sparkles size={Math.round(size * 0.55)} strokeWidth={2.2} />
    </span>
  )
}
