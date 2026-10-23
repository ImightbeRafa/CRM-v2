/**
 * BetsyMark: Betsy's own presence (official mark, docs/design/betsy-mascot-handoff/HANDOFF.md).
 * A chat-tail bubble with two bubble eyes and the 90° wordmark gradient. Dependency-free and
 * server-safe (only `useId`); motion is transform/opacity from one CSS module and stops under
 * prefers-reduced-motion or `animated={false}`.
 * Never use it to speak for a client's store, never recolor it, one mark per view.
 */
import * as React from 'react'
import s from './betsy-mark.module.css'

export type BetsyState = 'idle' | 'listen' | 'think' | 'typing' | 'speak' | 'yes' | 'paused'
export type BetsyTone = 'dark' | 'cream' | 'mono-white' | 'mono-ink'
export type BetsyGaze = 'read' | 'center' | 'up' | { x: number; y: number }

export const BETSY_STATES: ReadonlyArray<BetsyState> = ['idle', 'listen', 'think', 'typing', 'speak', 'yes', 'paused']

export interface BetsyMarkProps {
  /** Pixel size of the square mark. <=16 renders the merged-eye micro cut. Default 40. */
  size?: number
  state?: BetsyState
  /** 0–1 voice level, used by `speak`. */
  level?: number
  /** Eye direction. Default 'read' (down-left, toward the chat / tail). */
  gaze?: BetsyGaze
  tone?: BetsyTone
  /** false = still pose. prefers-reduced-motion always forces a still pose. */
  animated?: boolean
  /** Change this number to play the double blink ("leído"). */
  readSignal?: number
  /** Decorative when it sits next to text that already says "Betsy". */
  decorative?: boolean
  /** Accessible name. Default "Betsy". */
  label?: string
  className?: string
  style?: React.CSSProperties
}

export const BETSY_COLORS = {
  blue: '#2F6BFF',
  mid: '#5644E4',
  violet: '#7A3FF0',
  eye: '#F4F6FF',
  ink: '#0B0B12',
  dark: '#07070C',
  cream: '#F6F5F2',
} as const

export const BETSY_MOTION = {
  breathMs: 4400,
  blinkCloseMs: 55,
  blinkOpenMs: 140,
  doubleBlinkGapMs: 220,
  leanMs: 380,
  thinkLapMs: 1800,
  hopMs: 900,
  spring: 'cubic-bezier(.34,1.56,.64,1)',
  easeOut: 'cubic-bezier(.22,1,.36,1)',
} as const

/** Body outline in the 120-unit space (exported for lockups / favicons). */
export const BETSY_BODY_PATH =
  'M58 14H68C89 14 106 31 106 52V60C106 81 89 98 68 98H36L15 107C12.6 108 11 105.6 12.4 103.6L22 88C19.4 83 18 77.6 18 72V52C18 31 35 14 56 14Z'
const FACE = { x: 62, y: 54 }
const GAP = 23

/** Rounded square with one tight bottom-left corner: a tiny chat bubble. */
export function eyePath(cx: number, cy: number, w: number, h: number, r = 4.2, rt = 1.2): string {
  const x = cx - w / 2
  const y = cy - h / 2
  r = Math.min(r, w / 2, h / 2)
  rt = Math.min(rt, r)
  const f = (n: number) => +n.toFixed(2)
  return `M${f(x + r)} ${f(y)}H${f(x + w - r)}Q${f(x + w)} ${f(y)} ${f(x + w)} ${f(y + r)}V${f(y + h - r)}Q${f(x + w)} ${f(y + h)} ${f(x + w - r)} ${f(y + h)}H${f(x + rt)}Q${f(x)} ${f(y + h)} ${f(x)} ${f(y + h - rt)}V${f(y + r)}Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)}Z`
}

function gazeOffset(g: BetsyGaze, state: BetsyState): { x: number; y: number } {
  if (state === 'think') return { x: 4, y: -4 }
  if (state === 'yes') return { x: 0, y: 0 }
  if (state === 'paused') return { x: 0, y: 1 }
  if (state === 'listen' && g === 'read') return { x: -5, y: 3.5 }
  if (typeof g === 'object') return { x: Math.max(-6, Math.min(6, g.x)), y: Math.max(-6, Math.min(6, g.y)) }
  return g === 'center' ? { x: 0, y: 0 } : g === 'up' ? { x: 3, y: -4 } : { x: -3.5, y: 3 }
}

function eyeHeight(state: BetsyState): number {
  switch (state) {
    case 'listen':
      return 15
    case 'think':
      return 8
    case 'typing':
      return 10
    case 'paused':
      return 3.2
    default:
      return 14
  }
}

export function BetsyMark({
  size = 40,
  state = 'idle',
  level = 0.6,
  gaze = 'read',
  tone = 'dark',
  animated = true,
  readSignal,
  decorative = false,
  label = 'Betsy',
  className,
  style,
}: BetsyMarkProps): React.JSX.Element {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const gid = `bmg${uid}`
  const wid = `bmw${uid}`
  const cid = `bmc${uid}`
  const tid = `bmt${uid}`
  const micro = size <= 16
  const showLight = size >= 32 && (tone === 'dark' || tone === 'cream')
  const mono = tone === 'mono-white' || tone === 'mono-ink'
  const bodyFill = tone === 'mono-white' ? '#FFFFFF' : tone === 'mono-ink' ? BETSY_COLORS.ink : `url(#${gid})`
  const eyeFill = tone === 'mono-white' ? BETSY_COLORS.ink : mono ? '#FFFFFF' : BETSY_COLORS.eye
  const on = animated && !micro && state !== 'paused'
  const g = gazeOffset(gaze, state)
  const lean = state === 'listen' ? 'translate(-2.6px,1.2px)' : 'translate(0px,0px)'
  const eh = eyeHeight(state)
  const lvl = Math.max(0, Math.min(1, level))

  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label }
  const blinkClass = readSignal !== undefined ? s.dbl : state === 'idle' || state === 'listen' ? s.blink : ''

  const openEyes = (
    <g className={`${s.eyes} ${blinkClass}`} key={`e${readSignal ?? ''}`}>
      <path d={eyePath(FACE.x - GAP / 2, FACE.y, 12, eh)} fill={eyeFill} />
      <path d={eyePath(FACE.x + GAP / 2, FACE.y, 12, eh)} fill={eyeFill} />
    </g>
  )

  return (
    <span
      className={`${s.bm} ${className ?? ''}`}
      data-state={state}
      data-on={on ? '' : undefined}
      style={{ ['--bm-lvl' as string]: lvl, fontSize: size, ...style } as React.CSSProperties}
      {...a11y}
    >
      <svg width={size} height={size} viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={BETSY_COLORS.blue} />
            <stop offset=".5" stopColor={BETSY_COLORS.mid} />
            <stop offset="1" stopColor={BETSY_COLORS.violet} />
          </linearGradient>
          {showLight && (
            <linearGradient id={wid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".16" />
              <stop offset=".42" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          )}
          {showLight && state === 'think' && (
            <>
              <radialGradient id={tid}>
                <stop offset="0" stopColor="#C9D4FF" stopOpacity=".38" />
                <stop offset="1" stopColor="#C9D4FF" stopOpacity="0" />
              </radialGradient>
              <clipPath id={cid}>
                <path d={BETSY_BODY_PATH} />
              </clipPath>
            </>
          )}
        </defs>
        <g className={s.lean} style={{ transform: lean }}>
          <g className={s.hop} key={`h${state}`}>
            <g className={s.breath}>
              <path d={BETSY_BODY_PATH} fill={bodyFill} />
              {showLight && <path d={BETSY_BODY_PATH} fill={`url(#${wid})`} />}
              {showLight && state === 'think' && (
                <g clipPath={`url(#${cid})`}>
                  <g className={s.orbit}>
                    <circle cx={FACE.x + 26} cy={FACE.y + 4} r="17" fill={`url(#${tid})`} />
                  </g>
                </g>
              )}
              <g className={s.gaze} style={{ transform: `translate(${g.x}px,${g.y}px)` }}>
                {micro ? (
                  <rect x={FACE.x - 19} y={FACE.y - 6} width="38" height="12" rx="6" fill={eyeFill} />
                ) : state === 'yes' ? (
                  <>
                    <g className={s.arcs}>
                      {[FACE.x - GAP / 2, FACE.x + GAP / 2].map((x) => (
                        <path
                          key={x}
                          d={`M${x - 6} ${FACE.y + 3}Q${x} ${FACE.y - 7} ${x + 6} ${FACE.y + 3}`}
                          fill="none"
                          stroke={eyeFill}
                          strokeWidth="3.4"
                          strokeLinecap="round"
                        />
                      ))}
                    </g>
                    <g className={s.open}>{openEyes}</g>
                  </>
                ) : (
                  openEyes
                )}
              </g>
            </g>
          </g>
        </g>
      </svg>
      {state === 'typing' && !micro && (
        <span aria-hidden="true" className={s.dots}>
          <i className={s.dot} />
          <i className={s.dot} />
          <i className={s.dot} />
        </span>
      )}
    </span>
  )
}

export default BetsyMark
