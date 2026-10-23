import type { CSSProperties } from 'react'
import s from './night-sky.module.css'
import { SkyWatch } from './SkyWatch'

/**
 * Night sky for Betsy's dark marketing bands (home, /soporte), Rafael 2026-10-23: deep sky, a few twinkling stars,
 * one small constellation that draws itself, a faint nebula in the Betsy gradient, and soft clouds drifting at the
 * dark→light edges. Server-rendered and deterministic (seeded); no canvas, no layout: everything is absolute and only
 * transform/opacity animate. SkyWatch runs it only while on screen and the tab is visible; reduced motion = still.
 * Decorative (aria-hidden). Put it first inside a `position: relative` dark band; content above it needs z-index ≥ 1.
 */

/** Light neighbour the clouds melt into (matches the landing `--canvas` / `--paper` tokens). */
export type SkyEdge = 'canvas' | 'paper' | 'none'
const EDGE_RGB: Record<Exclude<SkyEdge, 'none'>, string> = { canvas: '246, 245, 242', paper: '255, 255, 255' }

/** Small star patterns in a 100×60 box: points + segments (index pairs), drawn in segment order. */
const CONSTELLATIONS = [
  // Cruz del Sur (low on the horizon from Costa Rica)
  { pts: [[50, 4], [50, 56], [30, 26], [72, 32], [60, 40]], seg: [[0, 1], [2, 3]] },
  // A small dipper
  { pts: [[6, 40], [22, 34], [38, 36], [52, 28], [66, 36], [86, 30], [80, 50]], seg: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 4]] },
  // Three-star belt with shoulders
  { pts: [[20, 8], [78, 12], [40, 32], [50, 30], [60, 28], [24, 54], [80, 52]], seg: [[0, 3], [1, 3], [2, 3], [3, 4], [2, 5], [4, 6]] },
] as const

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pct = (n: number) => `${n.toFixed(2)}%`

export function NightSky({
  seed = 1,
  top = 'none',
  bottom = 'none',
  stars = 54,
  constellation = { x: 78, y: 14, w: 140 },
  className = '',
}: {
  seed?: number
  /** Light section above / below: clouds melt into it. 'none' = no clouds on that edge. */
  top?: SkyEdge
  bottom?: SkyEdge
  stars?: number
  /** Where the constellation sits (% of the band) and its width in px; null = none. */
  constellation?: { x: number; y: number; w: number } | null
  className?: string
}) {
  const r = rng(seed)
  const field = Array.from({ length: stars }, (_, i) => {
    const size = r() < 0.1 ? 2.8 : r() < 0.45 ? 2 : 1.4
    const tw = r()
    return {
      i,
      x: r() * 100,
      y: 4 + r() * 92,
      size,
      alpha: 0.45 + r() * 0.5,
      // about a third twinkle, on two rhythms with spread-out phases
      tw: tw < 0.18 ? s.twA : tw < 0.34 ? s.twB : '',
      delay: -(r() * 7),
    }
  })
  const c = CONSTELLATIONS[Math.floor(r() * CONSTELLATIONS.length)]

  return (
    <div className={`${s.sky} ${className}`} aria-hidden data-top={top} data-bottom={bottom}>
      <SkyWatch />
      <div className={s.nebula} />
      <div className={s.stars}>
        {field.map((st) => (
          <i
            key={st.i}
            className={st.tw}
            style={
              {
                left: pct(st.x),
                top: pct(st.y),
                width: st.size,
                height: st.size,
                '--a': st.alpha.toFixed(2),
                animationDelay: st.tw ? `${st.delay.toFixed(2)}s` : undefined,
              } as CSSProperties
            }
          />
        ))}
      </div>
      {constellation && (
        <svg
          className={s.constellation}
          viewBox="0 0 100 60"
          style={{ left: pct(constellation.x), top: pct(constellation.y), width: constellation.w }}
          focusable="false"
        >
          {c.seg.map(([a, b], k) => {
            const p = c.pts[a]
            const q = c.pts[b]
            if (!p || !q) return null
            return (
              <line
                key={k}
                className={s.segment}
                x1={p[0]}
                y1={p[1]}
                x2={q[0]}
                y2={q[1]}
                style={{ animationDelay: `${(k * 0.7).toFixed(1)}s` }}
              />
            )
          })}
          {c.pts.map(([x, y], k) => (
            <circle key={k} className={s.cStar} cx={x} cy={y} r={k === 0 ? 1.8 : 1.4} />
          ))}
        </svg>
      )}
      {top !== 'none' && (
        <div className={`${s.clouds} ${s.cloudsTop}`} style={{ '--cloud-rgb': EDGE_RGB[top] } as CSSProperties}>
          <div className={`${s.band} ${s.bandBack}`} />
          <div className={`${s.band} ${s.bandFront}`} />
        </div>
      )}
      {bottom !== 'none' && (
        <div className={`${s.clouds} ${s.cloudsBottom}`} style={{ '--cloud-rgb': EDGE_RGB[bottom] } as CSSProperties}>
          <div className={`${s.band} ${s.bandBack}`} />
          <div className={`${s.band} ${s.bandFront}`} />
        </div>
      )}
    </div>
  )
}
