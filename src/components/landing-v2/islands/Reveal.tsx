'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * Adds data-in="false" while off-screen and "true" once seen (CSS does the motion). Server HTML has no data-in, so
 * everything is visible without JS. `loop` keeps toggling, so looping decorations pause off-screen.
 */
export function Reveal({
  children,
  className,
  style,
  loop = false,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  loop?: boolean
  as?: 'div' | 'ol' | 'section'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const [state, setState] = useState<'true' | 'false' | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setState('true')
          if (!loop) io.disconnect()
        } else {
          setState((prev) => (prev === 'true' && !loop ? 'true' : 'false'))
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loop])

  return (
    <Tag ref={ref as never} className={className} style={style} data-in={state}>
      {children}
    </Tag>
  )
}
