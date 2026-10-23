'use client'

import { BetsyLogo, type BetsyLogoProps } from './BetsyLogo'
import { useBetsyPresence } from './useBetsyPresence'

/**
 * The app's one live Betsy mark (sidebar): breathes and blinks, double-blinks on read / Respondido,
 * thinks while an AI reply forms, listens, hops on "Pago verificado" (signals from `emitBetsySignal`).
 * Its own component so a signal re-renders only the logo, not the whole sidebar.
 */
export function LiveBetsyLogo(props: Omit<BetsyLogoProps, 'animated' | 'markState'>) {
  const presence = useBetsyPresence()
  return <BetsyLogo {...props} animated markState={presence} />
}
