'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Steps a scripted demo through `durations` (ms per step), looping. Stops while paused, off-screen or in a hidden
 * tab. With reduced motion it never runs and sits on `restStep` (the finished state).
 */
export function useTimeline(durations: number[], opts: { restStep: number; reduced: boolean; visible: boolean }) {
  const [step, setStep] = useState(opts.reduced ? opts.restStep : 0)
  const [paused, setPaused] = useState(opts.reduced)
  const [pageHidden, setPageHidden] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const onVis = () => setPageHidden(document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const running = !paused && !opts.reduced && opts.visible && !pageHidden

  useEffect(() => {
    if (!running) return
    timer.current = setTimeout(() => setStep((x) => (x + 1) % durations.length), durations[step] ?? 3000)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [running, step, durations])

  const toggle = useCallback(() => setPaused((p) => !p), [])
  const replay = useCallback(() => {
    setStep(0)
    setPaused(false)
  }, [])
  const goTo = useCallback((i: number) => setStep(i), [])

  return { step, paused: paused || opts.reduced, running, toggle, replay, goTo, setPaused }
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** True while `ref` is at least partly on screen. */
export function useOnScreen<T extends Element>(ref: React.RefObject<T | null>, rootMargin = '0px'): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOn(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return on
}
