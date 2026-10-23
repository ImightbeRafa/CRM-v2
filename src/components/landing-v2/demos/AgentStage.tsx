import s from '../landing.module.css'
import { AGENT } from '../content'

/** Pure frames of the agent explainer (server poster + player). Light UI, the same parts as the real inbox. */

export const AGENT_STEP_MS = 6500

const d = (sec: number) => ({ animationDelay: `${sec}s` })

function Head({ chip }: { chip: React.ReactNode }) {
  return (
    <div className={s.panelHead}>
      <span className={s.avatar}>
        AV
        <i className={s.waDot} />
      </span>
      <span className={s.who}>
        <b>Andrea V.</b>
        WhatsApp · Línea ventas
      </span>
      <span style={{ marginLeft: 'auto' }}>{chip}</span>
    </div>
  )
}

function Bar({ left, right }: { left: React.ReactNode; right: string }) {
  return (
    <div className={s.statusBar}>
      <span>{left}</span>
      <span className={s.takeover}>{right}</span>
    </div>
  )
}

const live = (
  <>
    <span className={s.liveDot} style={{ display: 'inline-block', marginRight: 6 }} />
    <b>IA activa</b> · Pausar
  </>
)

export function AgentStage({ step }: { step: number }) {
  return (
    <div className={`${s.panel} ${s.agentStage}`} key={step}>
      {step === 0 && (
        <>
          <Head chip={<span className={`${s.chip} ${s.chipIa}`}>✦ IA</span>} />
          <div className={s.thread}>
            <p className={`${s.bubble} ${s.bubbleIn}`}>¿Hacen envíos a Pérez Zeledón? ¿Cuánto tarda?</p>
            <p className={`${s.bubble} ${s.bubbleOut}`} style={d(0.9)}>
              Sí 😊 Por Correos llega en 2 a 3 días hábiles
            </p>
            <p className={`${s.bubble} ${s.bubbleOut}`} style={d(1.8)}>
              ¿Querés que te lo aparte?
            </p>
            <span className={s.bubbleMeta} style={d(2.2)}>
              ✦ Sofi · 3:15 p. m.
            </span>
          </div>
          <Bar left={live} right="Tomar control" />
        </>
      )}
      {step === 1 && (
        <>
          <Head chip={<span className={`${s.chip} ${s.chipPersona}`}>👤 Persona</span>} />
          <div className={s.thread}>
            <p className={`${s.bubble} ${s.bubbleIn}`}>El paquete me llegó abierto, quiero hablar con alguien</p>
            <p className={`${s.bubble} ${s.bubbleOut}`} style={d(0.9)}>
              Qué pena 😔 Te paso con alguien del equipo ya mismo
            </p>
          </div>
          <p className={s.handoff} style={d(1.8)}>
            <b>Necesita persona · Reclamo o devolución</b>
            <br />
            El agente le pasó este chat a una persona: tocá Tomar control para responder.
          </p>
          <Bar left={<b>Necesita persona</b>} right="Tomar control" />
        </>
      )}
      {step === 2 && (
        <>
          <Head chip={<span className={`${s.chip} ${s.chipWait}`}>↻ Seguimientos</span>} />
          <div className={s.thread}>
            <p className={`${s.bubble} ${s.bubbleIn}`}>Dejame pensarlo y te aviso</p>
            <span className={s.bubbleMeta} style={{ alignSelf: 'center' }}>
              Al día siguiente
            </span>
            <p className={`${s.bubble} ${s.bubbleOut}`} style={d(1)}>
              ¡Hola! ¿Te quedó alguna duda? Si querés te ayudamos a terminar tu pedido 😊
            </p>
            <span className={s.bubbleMeta} style={d(1.6)}>
              ↻ Seguimiento automático · no sube el chat en la Bandeja
            </span>
          </div>
          <Bar left={live} right="Tomar control" />
        </>
      )}
      {step === 3 && (
        <>
          <Head chip={<span className={`${s.chip} ${s.chipPersona}`}>👤 Humano</span>} />
          <div className={s.thread}>
            <p className={`${s.bubble} ${s.bubbleIn}`}>¿Me hacen precio por 3?</p>
            <p className={`${s.bubble} ${s.bubbleOut} ${s.bubbleTeam}`} style={d(1.6)}>
              Te hago uno especial, dame un toque 🙌
            </p>
            <span className={s.bubbleMeta} style={d(1.9)}>
              Respondió Carlos (equipo)
            </span>
          </div>
          <Bar left={<b>IA en pausa</b>} right="Reanudar IA" />
          <div className={s.pauseRow}>
            <span className={`${s.fakeBtn} ${s.fakeBtnHot}`}>Pausar</span>
            <span className={s.fakeBtn}>Tomar control</span>
            <span className={s.fakeBtn}>Pausar línea</span>
            <span className={s.fakeBtn}>Solo humanos</span>
          </div>
        </>
      )}
    </div>
  )
}

/** The step list (left column). Interactive in the player, static in the poster. */
export function AgentSteps({
  active,
  running = false,
  onPick,
}: {
  active: number
  running?: boolean
  onPick?: (i: number) => void
}) {
  return (
    <div role="tablist" aria-label="Qué hace el agente" aria-orientation="vertical" className={s.stepTabs}>
      {AGENT.steps.map((st, i) => (
        <button
          key={st.key}
          type="button"
          role="tab"
          id={`agent-tab-${st.key}`}
          aria-selected={i === active}
          aria-controls="agent-panel"
          tabIndex={i === active ? 0 : -1}
          className={s.stepTab}
          onClick={onPick ? () => onPick(i) : undefined}
          onKeyDown={
            onPick
              ? (e) => {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault()
                    onPick((i + 1) % AGENT.steps.length)
                  }
                  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                    e.preventDefault()
                    onPick((i - 1 + AGENT.steps.length) % AGENT.steps.length)
                  }
                }
              : undefined
          }
        >
          <span className={s.stepNum}>{i + 1}</span>
          <span>
            <span className={s.cardTitle} style={{ display: 'block', fontSize: 16 }}>
              {st.title}
            </span>
            <span className={s.small}>{st.text}</span>
          </span>
          {i === active && (
            <span
              className={`${s.progress} ${running ? s.progressRun : ''}`}
              style={{ ['--dur' as string]: `${AGENT_STEP_MS}ms` }}
              key={`${active}-${running}`}
            />
          )}
        </button>
      ))}
    </div>
  )
}
