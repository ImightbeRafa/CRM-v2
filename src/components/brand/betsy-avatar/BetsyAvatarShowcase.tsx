import { BetsyLogo } from '../BetsyLogo'
import { AVATAR_MOODS, BetsyAvatar, type AvatarMood } from './BetsyAvatar'
import { CURATED_PERSONAS, resolveAvatarVariant } from './variants'
import s from './showcase.module.css'

const MOOD_LABEL: Record<AvatarMood, string> = {
  idle: 'En reposo',
  listening: 'Escuchando',
  thinking: 'Pensando',
  talking: 'Hablando',
  happy: 'Feliz',
  paused: 'En pausa',
}
const SIZES = [16, 20, 24, 32, 48, 64, 96, 128]
/** Agents without a curated persona get a generated face (examples). */
const GENERATED = ['Ventas tienda', 'Soporte', 'Mila', 'Reservas', 'Nico', 'Citas']

function Band({ tone }: { tone: 'dark' | 'light' }) {
  return (
    <section className={`${s.band} ${tone === 'dark' ? s.dark : s.light}`} data-tone={tone}>
      <h2 className={s.h}>{tone === 'dark' ? 'Fondo oscuro' : 'Fondo claro'}</h2>

      <div className={s.row}>
        <BetsyLogo tone={tone} size={44} />
        <BetsyLogo tone={tone} size={24} />
      </div>

      <h3 className={s.sub}>Estados</h3>
      <ul className={s.grid}>
        {AVATAR_MOODS.map((mood) => (
          <li key={mood} className={s.cell}>
            <BetsyAvatar size={96} mood={mood} label={`Betsy, ${MOOD_LABEL[mood]}`} />
            <span className={s.cap}>{MOOD_LABEL[mood]}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Agentes</h3>
      <ul className={s.grid}>
        {CURATED_PERSONAS.map((name) => (
          <li key={name} className={s.cell}>
            <BetsyAvatar size={72} variant={resolveAvatarVariant({ introductionNames: [name] })} />
            <span className={s.cap}>{name}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Agentes nuevos (variante generada)</h3>
      <ul className={s.grid}>
        {GENERATED.map((name) => (
          <li key={name} className={s.cell}>
            <BetsyAvatar size={56} agent={{ name }} />
            <span className={s.cap}>{name}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Tamaños</h3>
      <div className={s.row}>
        {SIZES.map((size) => (
          <BetsyAvatar key={size} size={size} label={`Betsy ${size}px`} />
        ))}
      </div>
    </section>
  )
}

/** Every mood × variant × size, logo included, on both surfaces. */
export function BetsyAvatarShowcase() {
  return (
    <div className={s.wrap}>
      <Band tone="dark" />
      <Band tone="light" />
    </div>
  )
}
