import { ArrowRight } from 'lucide-react'
import s from '../landing.module.css'
import { AGENT, LINKS } from '../content'
import { AgentStage, AgentSteps } from '../demos/AgentStage'
import { DemoFrame } from '../demos/DemoFrame'
import { LazyDemo } from '../demos/LazyDemo'
import { NicheTabs } from '../islands/NicheTabs'
import { AgentCostumes } from '../islands/AgentCostumes'

/** Light section: what the agent does (interactive explainer) + examples per type of business. */
export function Agent() {
  return (
    <section id="agente" className={`${s.section} ${s.light}`} aria-labelledby="lv2-agent-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>{AGENT.label}</p>
          <h2 id="lv2-agent-title" className={`landing-h2 ${s.display}`}>
            {AGENT.title}
            <em>{AGENT.titleEm}</em>
          </h2>
          <p className={s.lead}>{AGENT.lead}</p>
        </div>
        <LazyDemo which="agent">
          <div className={s.agentGrid}>
            <AgentSteps active={0} />
            <div role="tabpanel" id="agent-panel" aria-labelledby="agent-tab-info">
              <DemoFrame title="Betsy · Chats" light>
                <AgentStage step={0} />
              </DemoFrame>
              <p className={s.agentText}>
                <b style={{ color: 'var(--ink)' }}>{AGENT.steps[0].title}.</b> {AGENT.steps[0].text}
              </p>
            </div>
          </div>
        </LazyDemo>

        <div style={{ marginTop: 'var(--section-y)' }}>
          <p className={s.eyebrow}>Tu agente</p>
          <h3 className={`${s.cardTitle} ${s.h3Big}`}>Así trabaja, con tus colores.</h3>
          <p className={s.small} style={{ maxWidth: 560 }}>
            Cada negocio tiene su propio agente, con su nombre y su color. Mirá cómo atiende un chat de principio a fin,
            y probá otro ejemplo u otro color.
          </p>
          <AgentCostumes />
        </div>

        <div style={{ marginTop: 'var(--section-y)' }}>
          <p className={s.eyebrow}>Para tu tipo de negocio</p>
          <h3 className={`${s.cardTitle} ${s.h3Big}`}>
            Así suena en negocios como el tuyo.
          </h3>
          <p className={s.small} style={{ maxWidth: 560 }}>
            Ejemplos de conversaciones. Tu agente habla con tus productos, tus precios y tu forma de atender.
          </p>
          <NicheTabs />
          <p className={s.small} style={{ marginTop: 20 }}>
            ¿Tu negocio no está en la lista?{' '}
            <a href={LINKS.agent} className={s.inlineIcon} style={{ color: 'var(--indigo-ink)', fontWeight: 650 }}>
              Contanos qué vendés <ArrowRight size={14} aria-hidden />
            </a>
          </p>
        </div>
      </div>
    </section>
  )
}
