'use client'

import { useId, useState } from 'react'
import { AgentMark, PlateSwatch } from '@/components/brand/AgentMark'
import { AGENT_PLATES, AGENT_PLATE_LABELS, type AgentPlate } from '@/lib/agent-appearance'
import s from '../landing.module.css'

/**
 * "Tu agente, con tu nombre y tus colores": the same costume as the Agents tab (Lane I's AgentMark) — Betsy's
 * official mark on a colored plate plus the agent's name. The mark is never recolored (handoff rule); only the plate.
 * One mark in this view: the example agents and colors are swatches, only the preview shows the mark.
 * Example names and businesses are made up — never live client personas (Lane I / handoff).
 */
const PRESETS: ReadonlyArray<{ name: string; business: string; plate: AgentPlate; greeting: string }> = [
  { name: 'Luna', business: 'Suplementos', plate: 'teal', greeting: '¡Hola! Soy Luna 😊 ¿Te ayudo con los parches?' },
  { name: 'Nico', business: 'Ropa', plate: 'violet', greeting: '¡Hola! Soy Nico. ¿Qué talla buscás?' },
  { name: 'Ana', business: 'Dental y belleza', plate: 'rose', greeting: 'Hola, soy Ana. ¿Te cuento cómo funciona el kit?' },
  { name: 'Max', business: 'Gadgets', plate: 'amber', greeting: '¡Buenas! Soy Max. ¿Para qué celular lo necesitás?' },
]

export function AgentCostumes() {
  const [preset, setPreset] = useState(0)
  const [name, setName] = useState<string>(PRESETS[0].name)
  const [plate, setPlate] = useState<AgentPlate>(PRESETS[0].plate)
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
        <AgentMark appearance={{ plate, ring: false }} size={88} />
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
              <PlateSwatch plate={x.plate} />
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
      </div>
    </div>
  )
}
