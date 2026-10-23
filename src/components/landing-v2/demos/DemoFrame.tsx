import type { ReactNode } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import s from '../landing.module.css'

/** Window chrome around a demo. `controls` only exist once the player has loaded (the poster has none). */
export function DemoFrame({
  title,
  light = false,
  controls,
  children,
}: {
  title: string
  light?: boolean
  controls?: { paused: boolean; onToggle: () => void; onReplay: () => void }
  children: ReactNode
}) {
  return (
    <div className={`${s.demoShell} ${light ? s.lightShell : ''}`}>
      <div className={s.demoBar}>
        <span className={s.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={s.demoTitle}>{title}</span>
        <span className={s.controls}>
          {controls ? (
            <>
              <button type="button" className={s.iconBtn} onClick={controls.onToggle}>
                {controls.paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
                {controls.paused ? 'Seguir' : 'Pausar'}
              </button>
              <button type="button" className={s.iconBtn} onClick={controls.onReplay}>
                <RotateCcw size={12} aria-hidden /> Repetir
              </button>
            </>
          ) : (
            <span style={{ height: 32 }} />
          )}
        </span>
      </div>
      <div className={s.stage} aria-hidden>
        {children}
      </div>
    </div>
  )
}
