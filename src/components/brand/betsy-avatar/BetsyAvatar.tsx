import { useId } from 'react'
import s from './betsy-avatar.module.css'
import {
  BETSY_VARIANT,
  resolveAvatarVariant,
  type AvatarShape,
  type AvatarSource,
  type AvatarVariant,
} from './variants'

export type AvatarMood = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'paused'

export const AVATAR_MOODS: ReadonlyArray<AvatarMood> = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'paused',
]

export type BetsyAvatarProps = {
  /** Rendered box in px (square). Crisp from 16 to 256. */
  size?: number
  mood?: AvatarMood
  /** Explicit variant (wins over `agent`). Default: Betsy herself. */
  variant?: AvatarVariant
  /** Resolve the variant deterministically from agent config. */
  agent?: AvatarSource
  /** Static render (no animation), on top of the automatic prefers-reduced-motion. */
  still?: boolean
  /** `hover`: frozen in its neutral pose until a `.group` ancestor is hovered or focused (lists). */
  motion?: 'always' | 'hover'
  /** Accessible name. Defaults to the variant's name; pass '' for a decorative avatar. */
  label?: string
  /** Small smile on idle/listening (default on from 28 px). */
  smile?: boolean
  className?: string
}

const SHAPE_PATH: Record<AvatarShape, string> = {
  drop: 'M50 9C67 9 85 33 88 55C90.5 77 72 91 50 91C28 91 9.5 77 12 55C15 33 33 9 50 9Z',
  orb: 'M50 12A39.5 39.5 0 1 1 49.99 12Z',
  pebble: 'M50 13C77 13 89 25 89 52C89 79 77 90 50 90C23 90 11 79 11 52C11 25 23 13 50 13Z',
}
/** Face center per shape (the drop's mass sits low). */
const FACE_Y: Record<AvatarShape, number> = { drop: 57, orb: 52, pebble: 53 }

/**
 * Betsy's character: a glossy night-indigo body with a blue→violet rim light, white eyes and
 * a small smile. Pure SVG + CSS (no runtime, no assets), server- and client-safe.
 */
export function BetsyAvatar({
  size = 48,
  mood = 'idle',
  variant,
  agent,
  still = false,
  motion = 'always',
  label,
  smile,
  className = '',
}: BetsyAvatarProps) {
  const uid = useId().replace(/:/g, '')
  const v = variant ?? (agent ? resolveAvatarVariant(agent) : BETSY_VARIANT)
  const { rim, body, accent } = v.palette
  const path = SHAPE_PATH[v.shape]
  const fy = FACE_Y[v.shape]
  /** Level of detail: gloss, mouth and ribbon only where they read. */
  const detail = size >= 28
  const tiny = size < 24
  const showSmile = smile ?? detail
  const id = (k: string) => `ba${uid}${k}`
  const decorative = label === ''
  const name = label ?? v.displayName

  // Small sizes need proportionally bigger eyes to read at all.
  const eyeRx = tiny ? 7.5 : detail ? 5.2 : 6.2
  const eyeRy = tiny ? 10 : detail ? 7 : 8.4
  const eyeDx = tiny ? 15 : detail ? 13 : 14

  let eyes: React.ReactNode
  if (mood === 'happy') {
    eyes = (
      <g fill="none" stroke="#fff" strokeWidth={tiny ? 4.5 : 3.6} strokeLinecap="round">
        <path d={`M${50 - eyeDx - 5} ${fy + 1}Q${50 - eyeDx} ${fy - 7} ${50 - eyeDx + 5} ${fy + 1}`} />
        <path d={`M${50 + eyeDx - 5} ${fy + 1}Q${50 + eyeDx} ${fy - 7} ${50 + eyeDx + 5} ${fy + 1}`} />
      </g>
    )
  } else if (mood === 'paused') {
    eyes = (
      <g fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={tiny ? 4.5 : 3.4} strokeLinecap="round">
        <path d={`M${50 - eyeDx - 5} ${fy + 1}Q${50 - eyeDx} ${fy + 5} ${50 - eyeDx + 5} ${fy + 1}`} />
        <path d={`M${50 + eyeDx - 5} ${fy + 1}Q${50 + eyeDx} ${fy + 5} ${50 + eyeDx + 5} ${fy + 1}`} />
      </g>
    )
  } else {
    eyes = (
      <g className={s.eyes}>
        <ellipse cx={50 - eyeDx} cy={fy} rx={eyeRx} ry={eyeRy} fill="#fff" />
        <ellipse cx={50 + eyeDx} cy={fy} rx={eyeRx} ry={eyeRy} fill="#fff" />
      </g>
    )
  }

  let mouth: React.ReactNode = null
  if (detail) {
    const my = fy + 13
    if (mood === 'talking') {
      mouth = <ellipse className={s.mouthTalk} cx={50} cy={my} rx={4.2} ry={3.2} fill={accent} />
    } else if (mood === 'happy') {
      mouth = (
        <path d={`M41 ${my - 2}Q50 ${my + 7} 59 ${my - 2}`} fill="none" stroke={accent} strokeWidth={2.8} strokeLinecap="round" />
      )
    } else if (mood === 'thinking') {
      mouth = <path d={`M46 ${my}H54`} stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
    } else if (mood !== 'paused' && showSmile) {
      mouth = (
        <path d={`M44 ${my - 1}Q50 ${my + 4} 56 ${my - 1}`} fill="none" stroke={accent} strokeWidth={2.6} strokeLinecap="round" />
      )
    }
  }

  const ribbon = mood === 'thinking' && !tiny
  const ribbonEllipse = (cls: string, clip: string) => (
    <g clipPath={`url(#${id(clip)})`}>
      <ellipse cx={50} cy={54} rx={47} ry={12} fill="none" stroke={`url(#${id('rb')})`} strokeOpacity={0.35} strokeWidth={1.6} />
      <ellipse
        className={cls}
        cx={50}
        cy={54}
        rx={47}
        ry={12}
        fill="none"
        stroke={`url(#${id('rb')})`}
        strokeWidth={2.6}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="34 66"
      />
    </g>
  )

  return (
    <span
      className={`${s.root} ${className}`}
      data-mood={mood}
      data-still={still ? 'true' : undefined}
      data-motion={motion === 'hover' ? 'hover' : undefined}
      data-variant={v.key}
      style={{ width: size, height: size }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={id('rim')} x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor={rim[0]} />
            <stop offset="0.55" stopColor={rim[1]} />
            <stop offset="1" stopColor={rim[2]} />
          </linearGradient>
          <radialGradient id={id('body')} cx="0.42" cy="0.34" r="0.72">
            <stop offset="0" stopColor={body[0]} />
            <stop offset="0.55" stopColor={body[1]} />
            <stop offset="1" stopColor={body[2]} />
          </radialGradient>
          <radialGradient id={id('gloss')} cx="0.5" cy="0" r="0.75">
            <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('core')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor={rim[1]} stopOpacity="0.55" />
            <stop offset="1" stopColor={rim[1]} stopOpacity="0" />
          </radialGradient>
          {detail ? (
            <filter id={id('glow')} x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.2" />
            </filter>
          ) : null}
          {ribbon ? (
            <>
              <linearGradient id={id('rb')} x1="0" x2="1">
                <stop offset="0" stopColor={rim[0]} />
                <stop offset="0.5" stopColor={rim[2]} />
                <stop offset="1" stopColor="#FFC7A1" />
              </linearGradient>
              <clipPath id={id('back')}>
                <rect x="0" y="0" width="100" height="54" />
              </clipPath>
              <clipPath id={id('front')}>
                <rect x="0" y="54" width="100" height="46" />
              </clipPath>
            </>
          ) : null}
        </defs>

        <g className={s.float}>
          {ribbon ? <g transform="rotate(-16 50 54)">{ribbonEllipse(s.ribbonDash, 'back')}</g> : null}
          {mood === 'listening' && detail ? (
            <path className={s.pulse} d={path} fill="none" stroke={rim[1]} strokeWidth={2} />
          ) : null}
          {detail ? (
            <path
              className={s.glow}
              d={path}
              fill="none"
              stroke={`url(#${id('rim')})`}
              strokeWidth={5}
              filter={`url(#${id('glow')})`}
            />
          ) : null}
          <path d={path} fill={`url(#${id('body')})`} stroke={`url(#${id('rim')})`} strokeWidth={tiny ? 6 : detail ? 2.2 : 4} />
          {detail ? <ellipse className={s.core} cx={50} cy={fy + 4} rx={26} ry={22} fill={`url(#${id('core')})`} /> : null}
          {detail ? (
            <ellipse cx={39} cy={fy - 30} rx={15} ry={7} fill={`url(#${id('gloss')})`} transform={`rotate(-22 39 ${fy - 30})`} />
          ) : null}
          <g className={s.face}>
            {eyes}
            {mouth}
          </g>
          {ribbon ? <g transform="rotate(-16 50 54)">{ribbonEllipse(s.ribbonDash, 'front')}</g> : null}
        </g>
      </svg>
    </span>
  )
}
