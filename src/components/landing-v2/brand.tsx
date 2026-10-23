import { BetsyLogo } from '@/components/brand/BetsyLogo'
import { BetsyMark, type BetsyGaze, type BetsyState } from '@/components/brand/BetsyMark'

/**
 * Brand slots for the home: the ONLY place landing-v2 renders Betsy's logo or mark (Lane I's official components,
 * from docs/design/betsy-mascot-handoff). Handoff rules applied here: one mark per view, never the hero over product
 * UI (the hero has no mascot; the mark lives in the demo's status bar and does the "yes" hop at "Pago verificado"),
 * gaze toward the content/CTA, the mark is never recolored (agent costumes color the plate, see AgentCostumes).
 */

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  // The outlined official wordmark (gradient on dark and cream alike).
  return <BetsyLogo size={tone === 'light' ? 19 : 23} tone={tone} ariaLabel="Betsy" />
}

export type MarkState = BetsyState

export function Mark({
  size = 32,
  state = 'idle',
  decorative = true,
  gaze = 'read',
}: {
  size?: number
  state?: MarkState
  decorative?: boolean
  gaze?: BetsyGaze
}) {
  return <BetsyMark size={size} state={state} gaze={gaze} decorative={decorative} />
}
