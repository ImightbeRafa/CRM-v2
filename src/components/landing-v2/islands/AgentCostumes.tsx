'use client'

import { useRef, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { AgentMark, PlateSwatch } from '@/components/brand/AgentMark'
import type { BetsyState } from '@/components/brand/BetsyMark'
import { AGENT_PLATES, AGENT_PLATE_LABELS, type AgentPlate } from '@/lib/agent-appearance'
import s from '../landing.module.css'
import { Chip } from '../ui/Chip'
import { useOnScreen, usePrefersReducedMotion, useTimeline } from '../demos/useTimeline'

/**
 * "Tu agente, en acción" (Rafael 2026-10-23): the agent's costume from the Agents tab (Lane I's AgentMark: Betsy's
 * official mark on a colored plate, never recolored) plus a looping mini-chat of what the agent does — answers with
 * the store's info, a person on the team verifies the payment ("yes"), hands off ("Necesita persona") and follows up
 * the next day. The mark's state follows each beat. Swatches change the plate; no name input (Rafael: silly).
 * One mark in this view (example chips and colors are swatches). Names and businesses are made up.
 */
type Preset = { name: string; business: string; plate: AgentPlate; ask: string; answer: string; human: string }

const PRESETS: ReadonlyArray<Preset> = [
  {
    name: 'Luna',
    business: 'Ropa',
    plate: 'teal',
    ask: '¿La blusa de lino la tienen en M?',
    answer: 'Sí, en blanco y en negro. Está en ₡14.500 😊',
    human: 'Quiero cambiar una talla de otro pedido',
  },
  {
    name: 'Nico',
    business: 'Cosméticos',
    plate: 'violet',
    ask: '¿Cuánto cuesta el protector solar?',
    answer: 'El de 50 ml está en ₡9.900. ¿Te lo envío?',
    human: 'Me dio alergia otro producto, ¿me ayuda alguien?',
  },
  {
    name: 'Ana',
    business: 'Repostería',
    plate: 'rose',
    ask: '¿Hacen queques para el sábado?',
    answer: 'Sí, con 2 días de anticipación. El de chocolate está en ₡18.000 🎂',
    human: 'También necesito uno para 80 personas',
  },
  {
    name: 'Max',
    business: 'Mascotas',
    plate: 'amber',
    ask: '¿Tienen arena para gato de 10 kg?',
    answer: 'Sí, está en ₡8.500. ¿Te la envío por Correos?',
    human: '¿Puedo hablar con una persona?',
  },
]

/** One beat per step: how long it shows and what the mark does. */
const BEATS: ReadonlyArray<{ ms: number; mark: BetsyState }> = [
  { ms: 1600, mark: 'listen' }, // 0 customer asks
  { ms: 1400, mark: 'typing' }, // 1 the agent writes
  { ms: 2300, mark: 'speak' }, // 2 the agent answers with the store's info
  { ms: 1700, mark: 'listen' }, // 3 the receipt arrives
  { ms: 2400, mark: 'yes' }, // 4 a person on the team verifies the payment
  { ms: 1700, mark: 'listen' }, // 5 the customer asks for something only a person can do
  { ms: 2800, mark: 'paused' }, // 6 hand-off: Necesita persona
  { ms: 3600, mark: 'speak' }, // 7 the next day: one follow-up
]
const DURATIONS = BEATS.map((b) => b.ms)
const LAST = BEATS.length - 1

export function AgentCostumes() {
  const ref = useRef<HTMLDivElement>(null)
  const [preset, setPreset] = useState(0)
  const [plate, setPlate] = useState<AgentPlate>(PRESETS[0].plate)
  const reduced = usePrefersReducedMotion()
  const visible = useOnScreen(ref)
  const t = useTimeline(DURATIONS, { restStep: LAST, reduced, visible })
  const step = reduced ? LAST : t.step
  const p = PRESETS[preset]

  const pick = (i: number) => {
    setPreset(i)
    setPlate(PRESETS[i].plate)
    t.replay()
  }

  return (
    <div ref={ref} className={s.costumes}>
      <div className={s.costumePreview}>
        <div className={s.costumeHead}>
          <AgentMark appearance={{ plate, ring: false }} size={64} state={BEATS[step].mark} animated={!reduced} />
          <div className={s.costumeId}>
            <b>{p.name}</b>
            <span>Agente de ventas · {p.business}</span>
          </div>
        </div>

        {/* A looping illustration (aria-hidden); the list next to it says the same in words. */}
        <div className={`${s.thread} ${s.costumeChat} ${s.light}`} aria-hidden key={preset}>
          <p className={`${s.bubble} ${s.bubbleIn}`}>{p.ask}</p>
          {step === 1 && (
            <span className={`${s.typing} ${s.typingOut}`}>
              <i />
              <i />
              <i />
            </span>
          )}
          {step >= 2 && <p className={`${s.bubble} ${s.bubbleOut}`}>{p.answer}</p>}
          {step >= 3 && (
            <p className={`${s.bubble} ${s.bubbleIn} ${s.inlineIcon}`}>
              <CreditCard size={13} aria-hidden /> Comprobante SINPE Móvil
            </p>
          )}
          {step >= 4 && (
            <span className={s.costumeEvent}>
              <Chip kind="live">
                Pago verificado por tu equipo
              </Chip>
            </span>
          )}
          {step >= 5 && <p className={`${s.bubble} ${s.bubbleIn}`}>{p.human}</p>}
          {step >= 6 && (
            <span className={s.costumeEvent}>
              <Chip kind="persona">
                Necesita persona · le avisó a tu equipo
              </Chip>
            </span>
          )}
          {step >= 7 && (
            <>
              <span className={s.costumeEvent}>
                <Chip kind="seguimiento">
                  Al día siguiente
                </Chip>
              </span>
              <p className={`${s.bubble} ${s.bubbleOut}`}>¡Hola! ¿Te quedó alguna duda? Con gusto te ayudo a terminar tu pedido.</p>
            </>
          )}
        </div>
      </div>

      <div className={s.costumeControls}>
        <p className={s.costumeLabel}>Ejemplos</p>
        <div className={s.costumeChips} role="radiogroup" aria-label="Agentes de ejemplo">
          {PRESETS.map((x, i) => (
            <button
              key={x.name}
              type="button"
              role="radio"
              aria-checked={i === preset}
              className={s.costumeChip}
              onClick={() => pick(i)}
            >
              <PlateSwatch plate={x.plate} />
              <span>
                <b>{x.name}</b>
                <small>{x.business}</small>
              </span>
            </button>
          ))}
        </div>

        <p className={s.costumeLabel}>Color de tu agente</p>
        <div className={s.costumeSwatches} role="radiogroup" aria-label="Color del agente">
          {AGENT_PLATES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={plate === c}
              aria-label={`Color ${AGENT_PLATE_LABELS[c]}`}
              className={s.costumeSwatch}
              onClick={() => setPlate(c)}
            >
              <PlateSwatch plate={c} />
            </button>
          ))}
        </div>

        <p className={s.costumeLabel}>Qué hace</p>
        <ul className={s.costumeFacts}>
          <li>Contesta con tu información: precios, tallas, envíos.</li>
          <li>Un pago lo confirma una persona de tu equipo, no el agente.</li>
          <li>Si el cliente necesita a alguien, el chat pasa a “Necesita persona”.</li>
          <li>A quien se quedó a medias le escribe una vez al día siguiente.</li>
        </ul>
        <p className={s.costumeHint}>Vista de ejemplo: los nombres y negocios son inventados.</p>
      </div>
    </div>
  )
}
