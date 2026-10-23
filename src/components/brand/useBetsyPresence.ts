'use client'

import { useEffect, useRef, useState } from 'react'
import type { BetsyState } from './BetsyMark'
import { BETSY_SIGNAL_EVENT, isBetsySignal, signalToStateEvent } from './betsy-signals'
import { useBetsyState } from './useBetsyState'

/** A think/typing that never gets its "done" (closed tab, error path) falls back to idle. */
const THINK_WATCHDOG_MS = 20_000
/** The double blink lasts 640 ms; after it the slow idle blink comes back. */
const READ_BLINK_MS = 700

/**
 * The live state of the one Betsy mark on screen (the sidebar's): listens to `emitBetsySignal`
 * events and maps them to the official states (HANDOFF.md `useBetsyState`).
 */
export function useBetsyPresence(): { state: BetsyState; level: number; readSignal: number | undefined } {
  const { state, level, readSignal, dispatch } = useBetsyState('idle')
  const [blink, setBlink] = useState<number | undefined>(undefined)
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const clearWatchdog = () => {
      if (watchdog.current) clearTimeout(watchdog.current)
      watchdog.current = null
    }
    const onSignal = (event: Event) => {
      const type = (event as CustomEvent<{ type?: unknown }>).detail?.type
      if (!isBetsySignal(type)) return
      const next = signalToStateEvent(type)
      // Only the reply lifecycle owns the watchdog (a read blink mid-think must not cancel it).
      if (next === 'reply_started' || next === 'reply_streaming') {
        clearWatchdog()
        watchdog.current = setTimeout(() => dispatch({ type: 'reply_done' }), THINK_WATCHDOG_MS)
      } else if (next === 'reply_done') {
        clearWatchdog()
      }
      dispatch({ type: next })
    }
    window.addEventListener(BETSY_SIGNAL_EVENT, onSignal)
    return () => {
      window.removeEventListener(BETSY_SIGNAL_EVENT, onSignal)
      clearWatchdog()
    }
  }, [dispatch])

  // Play the double blink once per read, then hand the eyes back to the idle blink.
  useEffect(() => {
    if (readSignal === undefined) return
    setBlink(readSignal)
    if (blinkTimer.current) clearTimeout(blinkTimer.current)
    blinkTimer.current = setTimeout(() => setBlink(undefined), READ_BLINK_MS)
    return () => {
      if (blinkTimer.current) clearTimeout(blinkTimer.current)
    }
  }, [readSignal])

  return { state, level, readSignal: blink }
}
