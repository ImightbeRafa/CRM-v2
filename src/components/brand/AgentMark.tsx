import { BetsyMark, type BetsyState } from './BetsyMark'
import type { AgentAppearance } from '@/lib/agent-appearance'
import s from './agent-mark.module.css'

/**
 * An agent's face in the owner UI: the official BetsyMark (never recolored) on the agent's colored
 * plate, with an optional ring. Decorative: the agent's name is always rendered next to it.
 * Owner-facing only; it never appears in customer messages.
 */
export function AgentMark({
  appearance,
  size = 52,
  state = 'idle',
  animated = true,
  className = '',
}: {
  appearance: Pick<AgentAppearance, 'plate' | 'ring'>
  /** Plate size in px; the mark is ~78 % of it (40 px mark on the 52 px plate). */
  size?: number
  state?: BetsyState
  animated?: boolean
  className?: string
}) {
  return (
    <span
      className={`${s.plate} ${className}`}
      data-plate={appearance.plate}
      data-ring={appearance.ring ? '' : undefined}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <BetsyMark size={Math.round(size * 0.78)} state={state} animated={animated} decorative gaze="center" />
    </span>
  )
}

/** A plate color as a small dot (appearance picker). */
export function PlateSwatch({ plate }: { plate: AgentAppearance['plate'] }) {
  return <span className={s.swatch} data-plate={plate} aria-hidden="true" />
}
