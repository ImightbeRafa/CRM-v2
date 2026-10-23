import { AgentMark } from './AgentMark'
import { BETSY_STATES, BetsyMark, type BetsyState } from './BetsyMark'
import { BetsyLogo } from './BetsyLogo'
import { AGENT_PLATES, AGENT_PLATE_LABELS, resolveAgentAppearance } from '@/lib/agent-appearance'
import s from './showcase.module.css'

const STATE_LABEL: Record<BetsyState, string> = {
  idle: 'En reposo',
  listen: 'Escucha',
  think: 'Piensa',
  typing: 'Escribe',
  speak: 'Habla',
  yes: 'Listo',
  paused: 'En pausa / Borrador',
}
const SIZES = [16, 24, 32, 40, 64, 96, 128]
const PERSONAS = ['Betsy', 'Sofi', 'Vale', 'Laura', 'Andrés', 'Dani', 'Caro']

function Band({ tone }: { tone: 'dark' | 'cream' }) {
  return (
    <section className={`${s.band} ${tone === 'dark' ? s.dark : s.cream}`}>
      <h2 className={s.h}>{tone === 'dark' ? 'Fondo oscuro' : 'Fondo crema'}</h2>
      <div className={s.row}>
        <BetsyLogo lockup size={40} animated />
        <BetsyLogo size={26} />
        <BetsyLogo mark size={22} />
      </div>

      <h3 className={s.sub}>Estados</h3>
      <ul className={s.grid}>
        {BETSY_STATES.map((state) => (
          <li key={state} className={s.cell}>
            <BetsyMark size={72} state={state} tone={tone} label={`Betsy, ${STATE_LABEL[state]}`} />
            <span className={s.cap}>{STATE_LABEL[state]}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Agentes (mismo Betsy, placa de color)</h3>
      <ul className={s.grid}>
        {PERSONAS.map((name, i) => (
          <li key={name} className={s.cell}>
            <AgentMark appearance={{ ...resolveAgentAppearance({ introductionNames: [name] }), ring: i === 0 }} size={52} animated={false} />
            <span className={s.cap}>{name}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Colores de placa</h3>
      <ul className={s.grid}>
        {AGENT_PLATES.map((plate) => (
          <li key={plate} className={s.cell}>
            <AgentMark appearance={{ plate, ring: false }} size={40} animated={false} />
            <span className={s.cap}>{AGENT_PLATE_LABELS[plate]}</span>
          </li>
        ))}
      </ul>

      <h3 className={s.sub}>Tamaños</h3>
      <div className={s.row}>
        {SIZES.map((size) => (
          <BetsyMark key={size} size={size} tone={tone} animated={false} label={`Betsy ${size}px`} />
        ))}
        <BetsyMark size={40} tone={tone === 'dark' ? 'mono-white' : 'mono-ink'} animated={false} label="Betsy monocromo" />
      </div>
    </section>
  )
}

/** Official Betsy mark: every state, size, lockup and agent plate, on dark and cream. */
export function BetsyBrandShowcase() {
  return (
    <div className={s.wrap}>
      <Band tone="dark" />
      <Band tone="cream" />
    </div>
  )
}
