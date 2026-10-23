'use client'

import { useEffect, useState } from 'react'
import type { BetsyState } from './BetsyMark'
import { BETSY_SIGNAL_EVENT, isBetsySignal } from './betsy-signals'
import { nextDeadline, PRESENCE_IDLE, presenceReduce, presenceView, type PresenceState } from './presence-machine'

/**
 * The live state of the one Betsy mark on screen (the sidebar's), from `emitBetsySignal` events.
 * Logic lives in `presence-machine.ts` (pure, tested); this hook stores it and re-renders once at
 * each deadline (end of a listen / yes / blink, or the reply watchdog).
 */
export function useBetsyPresence(): { state: BetsyState; readSignal: number | undefined } {
  const [machine, setMachine] = useState<PresenceState>(PRESENCE_IDLE)
  const [now, setNow] = useState(0)

  useEffect(() => {
    const onSignal = (event: Event) => {
      const type = (event as CustomEvent<{ type?: unknown }>).detail?.type
      if (!isBetsySignal(type)) return
      const t = Date.now()
      setMachine((s) => presenceReduce(s, type, t))
      setNow(t)
    }
    window.addEventListener(BETSY_SIGNAL_EVENT, onSignal)
    return () => window.removeEventListener(BETSY_SIGNAL_EVENT, onSignal)
  }, [])

  useEffect(() => {
    const at = nextDeadline(machine, now)
    if (at === null) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, at - now))
    return () => clearTimeout(timer)
  }, [machine, now])

  return presenceView(machine, now)
}
