'use client'

import { useId, useState } from 'react'
import s from '../landing.module.css'
import { Mark } from '../brand'

/**
 * "Tu agente, con tu nombre y tus colores": the same costume idea as the Agents tab — Betsy's official mark on a
 * colored plate plus the agent's name. The mark is never recolored (handoff rule); only the plate is.
 * One mark in this view: the example agents are color chips, only the preview shows the mark.
 * Example names and businesses are made up — never live client personas (Lane I / handoff).
 */
const PRESETS = [
  { name: 'Luna', business: 'Suplementos', plate: '#12938A', greeting: '¡Hola! Soy Luna 😊 ¿Te ayudo con los parches?' },
  { name: 'Nico', business: 'Ropa', plate: '#5B3FE0', greeting: '¡Hola! Soy Nico. ¿Qué talla buscás?' },
  { name: 'Ana', business: 'Dental y belleza', plate: '#D6457B', greeting: 'Hola, soy Ana. ¿Te cuento cómo funciona el kit?' },
  { name: 'Max', business: 'Gadgets', plate: '#E07A1F', greeting: '¡Buenas! Soy Max. ¿Para qué celular lo necesitás?' },
] as const

const PLATES = ['#5B6CFF', '#5B3FE0', '#D6457B', '#12938A', '#E07A1F', '#0B0B12'] as const

export function AgentCostumes() {
  const [preset, setPreset] = useState(0)
  const [name, setName] = useState<string>(PRESETS[0].name)
  const [plate, setPlate] = useState<string>(PRESETS[0].plate)
  const inputId = useId()
  const p = PRESETS[preset]
  const shownName = name.trim() || 'Tu agente'

  const pick = (i: number) => {
    setPreset(i)
    setName(PRESETS[i].name)
    setPlate(PRESETS[i].plate)
  }

  return (
    <div className={s.costumes}>
      <div className={s.costumePreview} aria-live="polite">
        <div className={s.costumePlate} style={{ background: plate }}>
          <Mark size={56} state="idle" decorative={false} />
        </div>
        <div className={s.costumeId}>
          <b>{shownName}</b>
          <span>Agente de ventas · {p.business}</span>
        </div>
        <p className={`${s.bubble} ${s.bubbleIn} ${s.costumeBubble}`}>{p.greeting.replace(p.name, shownName)}</p>
        <span className={s.costumeHint}>Vista de ejemplo</span>
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
              <span className={s.costumeDot} style={{ background: x.plate }} aria-hidden />
              <span>
                <b>{x.name}</b>
                <small>{x.business}</small>
              </span>
            </button>
          ))}
        </div>

        <label className={s.costumeLabel} htmlFor={inputId}>
          Probá con el tuyo: nombre
        </label>
        <input
          id={inputId}
          className={s.costumeInput}
          value={name}
          maxLength={16}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <p className={s.costumeLabel}>Color</p>
        <div className={s.costumeSwatches} role="radiogroup" aria-label="Color del agente">
          {PLATES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={plate === c}
              aria-label={`Color ${c}`}
              className={s.costumeSwatch}
              style={{ background: c }}
              onClick={() => setPlate(c)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
