'use client'

import { useRef, useState } from 'react'
import s from '../landing.module.css'
import { NICHES } from '../content'

/** "Para tu tipo de negocio": WAI tablist (arrow keys, Home/End), 44px touch targets, panel re-animates on change. */
export function NicheTabs() {
  const [active, setActive] = useState(0)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const n = NICHES[active]

  const pick = (i: number) => {
    setActive(i)
    tabs.current[i]?.focus()
    tabs.current[i]?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }

  return (
    <div className={s.light}>
      <div role="tablist" aria-label="Ejemplos por tipo de negocio" className={s.tabs}>
        {NICHES.map((x, i) => (
          <button
            key={x.key}
            ref={(el) => {
              tabs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`niche-tab-${x.key}`}
            aria-selected={i === active}
            aria-controls={`niche-panel-${x.key}`}
            tabIndex={i === active ? 0 : -1}
            className={s.tab}
            onClick={() => pick(i)}
            onKeyDown={(e) => {
              const last = NICHES.length - 1
              if (e.key === 'ArrowRight') pick(i === last ? 0 : i + 1)
              else if (e.key === 'ArrowLeft') pick(i === 0 ? last : i - 1)
              else if (e.key === 'Home') pick(0)
              else if (e.key === 'End') pick(last)
              else return
              e.preventDefault()
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div key={n.key} role="tabpanel" id={`niche-panel-${n.key}`} aria-labelledby={`niche-tab-${n.key}`} className={s.nichePanel}>
        <div className={s.nicheChat}>
          {n.chat.map((m, i) => (
            <p
              key={i}
              className={`${s.bubble} ${m.from === 'in' ? s.bubbleIn : s.bubbleOut}`}
              style={{ animationDelay: `${i * 0.35}s` }}
            >
              <span className={s.srOnly}>{m.from === 'in' ? 'Cliente: ' : 'Agente: '}</span>
              {m.text}
            </p>
          ))}
        </div>
        <div className={s.nicheNotes}>
          <p className={s.eyebrow} style={{ color: '#a9b1ff' }}>
            Lo que hace Betsy
          </p>
          <ul>
            {n.notes.map(([title, text]) => (
              <li key={title}>
                <span className={s.tick} aria-hidden>
                  ✓
                </span>
                <span>
                  <b>{title}:</b> {text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
