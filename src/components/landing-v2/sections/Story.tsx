import s from '../landing.module.css'
import { BUILD, COMING_SOON, TRUST } from '../content'
import { Package } from 'lucide-react'
import { Reveal } from '../islands/Reveal'
import { Chip, type ChipKind } from '../ui/Chip'

/** "Cómo creamos tu agente" (dark), "Lo que hay detrás" (light) and "Próximamente" (dark). */

export function Build() {
  return (
    <section className={`${s.section} ${s.dark} ${s.cv}`} aria-labelledby="lv2-build-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>{BUILD.label}</p>
          <h2 id="lv2-build-title" className={`landing-h2 ${s.display}`}>
            {BUILD.title}
          </h2>
        </div>
        <Reveal as="ol" className={s.buildList}>
          {BUILD.steps.map((st, n) => (
            <li key={st.title} className={s.buildItem} style={{ ['--i' as string]: n }}>
              <span className={s.buildNum} aria-hidden>
                {n + 1}
              </span>
              <h3>{st.title}</h3>
              <p className={s.small}>{st.text}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

export function Trust() {
  return (
    <section className={`${s.section} ${s.cv}`} aria-labelledby="lv2-trust-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>{TRUST.label}</p>
          <h2 id="lv2-trust-title" className={`landing-h2 ${s.display}`}>
            {TRUST.title}
          </h2>
        </div>
        <div className={s.trust}>
          {TRUST.items.map((t) => (
            <div key={t.title} className={s.trustItem}>
              <h3 className={s.cardTitle}>{t.title}</h3>
              <p className={s.small}>{t.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SoonVisual({ k }: { k: string }) {
  if (k === 'app')
    return (
      <div className={s.phone}>
        <span className={s.appTop}>Betsy</span>
        {(
          [
            ['DR', 'ia', 'IA'],
            ['CM', 'pago', 'Pago'],
            ['AV', 'persona', 'Persona'],
            ['JS', 'pedido', 'Pedido'],
          ] as const satisfies ReadonlyArray<readonly [string, ChipKind, string]>
        ).map(([ini, chip, label]) => (
          <span key={ini} className={s.appRow}>
            <span className={s.appAv}>{ini}</span>
            <span className={s.appLines}>
              <i />
              <i />
            </span>
            <Chip kind={chip} small>
              {label}
            </Chip>
          </span>
        ))}
        <span className={`${s.toast} ${s.inlineIcon}`}>
          <Package size={11} aria-hidden /> Nuevo pedido #2042
        </span>
      </div>
    )
  if (k === 'mcp')
    return (
      <div className={s.terminal}>
        <b>Vos:</b> ¿Cuántos pedidos quedaron sin guía hoy?
        <br />
        <b>Asistente:</b> Consultando Betsy… 3 pedidos sin guía.
        <span className={s.cursor} />
      </div>
    )
  if (k === 'tools')
    return (
      <div className={s.orbit}>
        <div className={s.orbitCore}>Betsy</div>
        {['Productos', 'Servicios', 'Reservas', 'Suscripciones'].map((x, n) => (
          <span key={x} style={{ ['--a' as string]: `${n * 90}deg` }}>
            {x}
          </span>
        ))}
      </div>
    )
  return (
    <div className={s.presets}>
      {[
        ['Agente de ventas', 'base'],
        ['Agente de soporte', 'base'],
        ['Agente de seguimiento', 'base'],
      ].map(([name, tag], n) => (
        <div key={name} className={s.preset}>
          <span className={s.toggle} style={{ ['--d' as string]: `${n * 0.8}s` }} />
          {name}
          <small>{tag}</small>
        </div>
      ))}
    </div>
  )
}

export function ComingSoon() {
  return (
    <section className={`${s.section} ${s.dark} ${s.cv}`} aria-labelledby="lv2-soon-title">
      <div className={s.wrap}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>{COMING_SOON.label}</p>
          <h2 id="lv2-soon-title" className={`landing-h2 ${s.display}`}>
            {COMING_SOON.title}
          </h2>
          <p className={s.lead}>{COMING_SOON.lead}</p>
        </div>
        <Reveal loop className={s.soonGrid}>
          {COMING_SOON.items.map((it) => (
            <article key={it.key} className={s.soon}>
              <span className={s.soonBadge}>Próximamente</span>
              <div className={`${s.soonVisual} ${s.loop}`} aria-hidden>
                <SoonVisual k={it.key} />
              </div>
              <div>
                <h3 className={s.cardTitle}>{it.title}</h3>
                <p className={s.small}>{it.text}</p>
              </div>
            </article>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
