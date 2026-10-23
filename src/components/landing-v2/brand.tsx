import s from './landing.module.css'

/**
 * Brand slots for the home. Lane I is building the shared <BetsyLogo /> (wordmark in the original blue→violet
 * gradient) and the animated <BetsyAvatar /> (moods idle / thinking / talking / happy). Until they land these
 * render the current wordmark and nothing; then each slot becomes one import, no layout change around it.
 */

export function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  return <span className={`${s.logo} ${tone === 'light' ? s.logoOnLight : ''}`}>Betsy</span>
}

export type AvatarMood = 'idle' | 'thinking' | 'talking' | 'happy'

/**
 * Where Betsy's avatar appears: the hero (companion of the live demo; mood follows the demo step), the agent
 * section header, and the contact card. Renders nothing until Lane I's <BetsyAvatar /> lands.
 */
export function AvatarSlot(_props: { place: 'hero' | 'agent' | 'contact'; mood?: AvatarMood; size?: number }) {
  return null
}
