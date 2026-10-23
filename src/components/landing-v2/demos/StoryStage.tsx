import { Check, CreditCard, Sparkles, Truck } from 'lucide-react'
import s from '../landing.module.css'
import { Chip as StatusChip } from '../ui/Chip'
import { Mark, type MarkState } from '../brand'
import { STORY } from '../content'

/**
 * One frame of the hero story (pure: no hooks, renders on the server as the poster and inside the player).
 * Bubbles that arrive in the same step are staggered with animation-delay; every change is transform/opacity.
 */

export const STORY_STEP_MS = [2600, 4300, 3600, 2900, 2400, 2300, 2900, 4200]
export const STORY_LAST = STORY_STEP_MS.length - 1

const d = (sec: number) => ({ animationDelay: `${sec}s` })

function Chip({ step }: { step: number }) {
  if (step >= 4) return <StatusChip kind="pedido">Pedido</StatusChip>
  if (step >= 2) return <StatusChip kind="pago">Revisar pago</StatusChip>
  return <StatusChip kind="ia">IA</StatusChip>
}

/** The demo's one Betsy mark reacts to the story: thinking while the reply forms, listening when the receipt lands,
 * the "yes" hop at Pago verificado (handoff), idle otherwise. */
function markState(step: number): MarkState {
  if (step === 0) return 'think'
  if (step === 2) return 'listen'
  if (step === 3) return 'yes'
  return 'idle'
}

/** Finer beats for the playing story (ms into the step → state): listen as the customer's message lands, typing
 * while the reply forms, speak while it arrives, idle once it's done. The poster and reduced motion use markState. */
export const STORY_MARK_BEATS: Partial<Record<number, ReadonlyArray<readonly [number, MarkState]>>> = {
  0: [[0, 'listen'], [900, 'typing']],
  1: [[0, 'speak'], [2600, 'idle']],
  2: [[0, 'listen'], [1400, 'idle']],
  3: [[0, 'yes']],
}

export function StoryStage({ step, mark }: { step: number; mark?: MarkState }) {
  const m = STORY.messages
  const c = STORY.customer
  const o = STORY.order
  const col = step >= 6 ? 2 : step >= 5 ? 1 : 0
  return (
    <div className={s.storyStage}>
      {/* Chat */}
      <div className={s.panel}>
        <div className={s.panelHead}>
          <span className={s.avatar}>
            {c.initials}
            <i className={s.igDot} />
          </span>
          <span className={s.who}>
            <b>{c.name}</b>
            {c.line}
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <Chip step={step} />
          </span>
        </div>
        <div className={s.thread}>
          <p className={`${s.bubble} ${s.bubbleIn}`}>{m.ask}</p>
          {step === 0 && (
            <span className={`${s.typing} ${s.typingOut}`} style={d(0.9)}>
              <i />
              <i />
              <i />
            </span>
          )}
          {step >= 1 && (
            <>
              <p className={`${s.bubble} ${s.bubbleOut}`}>{m.a1}</p>
              <p className={`${s.bubble} ${s.bubbleOut}`} style={d(step === 1 ? 0.9 : 0)}>
                {m.a2}
              </p>
              <p className={`${s.bubble} ${s.bubbleOut}`} style={d(step === 1 ? 1.9 : 0)}>
                {m.a3}
              </p>
              <span className={s.bubbleMeta} style={d(step === 1 ? 2.2 : 0)}>
                <Sparkles size={11} aria-hidden /> {STORY.agentName} · 10:42 p. m.
              </span>
            </>
          )}
          {step >= 2 && (
            <>
              <p className={`${s.bubble} ${s.bubbleIn}`}>{m.pick}</p>
              <div className={s.receipt} style={d(step === 2 ? 0.8 : 0)}>
                <div className={s.receiptImg}>SINPE MÓVIL</div>
              </div>
            </>
          )}
          {step >= 3 && (
            <>
              <p className={`${s.bubble} ${s.bubbleOut} ${s.bubbleTeam}`}>{m.a4}</p>
              <span className={s.bubbleMeta}>Respondió {m.a4By}</span>
            </>
          )}
        </div>
        <div className={s.statusBar}>
          <Mark size={18} state={mark ?? markState(step)} />
          {step >= 2 && step < 4 ? (
            <span>
              <b className={s.inlineIcon}>
                <CreditCard size={12} aria-hidden /> Pago por verificar
              </b>
            </span>
          ) : (
            <span>
              <b>IA activa</b> · Pausar
            </span>
          )}
          <span className={`${s.takeover} ${s.inlineIcon}`}>
            {step === 3 ? (
              <>
                Pago verificado <Check size={12} aria-hidden />
              </>
            ) : (
              'Tomar control'
            )}
          </span>
        </div>
      </div>

      {/* Orders board */}
      <div className={s.panel}>
        <div className={s.panelHead}>
          <b style={{ color: 'var(--d-text)', fontSize: 13 }}>Producción</b>
          <span style={{ marginLeft: 'auto' }}>Hoy</span>
        </div>
        <div className={s.board}>
          {STORY.columns.map((name, i) => (
            <div key={name} className={`${s.col} ${step >= 4 && col === i ? s.colActive : ''}`}>
              <span className={s.colTitle}>
                {name}
                <span>{(step >= 4 && col === i ? 1 : 0) + (i === 0 ? 2 : 1)}</span>
              </span>
              <span className={s.ghostCard} style={{ marginTop: 48 }} />
              {i === 0 && <span className={s.ghostCard} />}
            </div>
          ))}
          <div className={s.mover} data-col={col} data-hidden={step < 4}>
            <div className={s.orderCard}>
              <p className={s.orderId}>{o.id}</p>
              <p className={s.orderTop}>{c.name}</p>
              <p className={s.orderLine}>{o.item}</p>
              <div className={s.orderFoot}>
                <b>{o.total}</b>
                <span className={s.paidDot} title={o.pay}>
                  <Check size={11} strokeWidth={3} aria-hidden />
                </span>
              </div>
            </div>
          </div>
          <div className={`${s.guia} ${step >= 6 ? s.guiaShown : ''}`}>
            <span className={s.guiaBrand}>CORREOS DE COSTA RICA</span>
            <span className={s.guiaNum}>{STORY.guia.number}</span>
            <span className={s.barcode} />
            <span>
              {STORY.guia.to} · {STORY.guia.weight}
            </span>
            <span className={s.guiaStatus}>
              {step >= 7 ? (
                <>
                  <span className={s.truck}>
                    <Truck size={14} aria-hidden />
                  </span>{' '}
                  En tránsito
                </>
              ) : (
                'Guía creada'
              )}
            </span>
          </div>
        </div>
        <div className={s.stepper} aria-hidden>
          {STORY_STEP_MS.map((_, i) => (
            <i key={i} data-on={i <= step} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Server-rendered steps for screen readers (the animated stage is aria-hidden). */
export function StorySteps({ className }: { className?: string }) {
  return (
    <ol className={className}>
      {STORY.steps.map((st) => (
        <li key={st.caption}>{st.caption}</li>
      ))}
    </ol>
  )
}
