import { Check, Instagram, LifeBuoy, Mail, MessageCircle } from 'lucide-react'
import s from '../landing.module.css'
import { FAQ, LINKS, PRICING } from '../content'
import type { SupportContactConfig } from '@/lib/support/contact-config'

/** Pricing (from the single price source), FAQ, contact (from the support contact config) and footer. */

export function Pricing({
  price,
  trialDays,
}: {
  price: { base: string; iva: string; total: string; ivaPercent: string }
  trialDays: number
}) {
  return (
    <section id="precios" className={`${s.section} ${s.paper}`} aria-labelledby="lv2-price-title">
      <div className={s.wrap}>
        <div className={`${s.sectionHead} ${s.center}`}>
          <p className={s.eyebrow}>{PRICING.label}</p>
          <h2 id="lv2-price-title" className={`landing-h2 ${s.display}`}>
            {PRICING.title}
          </h2>
          <p className={s.lead}>{PRICING.lead}</p>
        </div>
        <div className={s.priceGrid}>
          <div className={s.priceCard}>
            <h3 className={s.cardTitle}>Betsy</h3>
            <p className={s.amount}>
              <strong>{price.base}</strong>
              <span>/mes + IVA</span>
            </p>
            <p className={s.small}>
              {price.base} + IVA {price.ivaPercent} ({price.iva}) = <b style={{ color: 'var(--ink)' }}>{price.total} al mes</b>
            </p>
            <ul className={s.feats}>
              {PRICING.plan.map((f) => (
                <li key={f}>
                  <Check size={16} aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className={s.priceCta}>
              <a className={s.btn} href={LINKS.signup}>
                Probar {trialDays} días gratis
              </a>
              <p className={s.small} style={{ textAlign: 'center' }}>
                Sin tarjeta para la prueba. Pagás con tarjeta por Tilopay.
              </p>
            </div>
          </div>
          <div className={`${s.priceCard} ${s.priceCardDark}`}>
            <h3 className={s.cardTitle}>{PRICING.agentTitle}</h3>
            <p className={s.amount}>
              <strong style={{ fontSize: 48 }}>{PRICING.agentPrice}</strong>
            </p>
            <p className={s.small} style={{ color: 'var(--d-muted)' }}>
              {PRICING.agentLead}
            </p>
            <ul className={s.feats}>
              {PRICING.agent.map((f) => (
                <li key={f}>
                  <Check size={16} aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
            <div className={s.priceCta}>
              <a className={s.btn} href={LINKS.agent}>
                Quiero mi agente
              </a>
              <a className={s.btnGhost} href={LINKS.support}>
                Tengo una pregunta
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Faq() {
  return (
    <section className={`${s.section} ${s.cv}`} aria-labelledby="lv2-faq-title">
      <div className={`${s.wrap} ${s.twoCol}`}>
        <div className={s.sectionHead}>
          <p className={s.eyebrow}>Preguntas</p>
          <h2 id="lv2-faq-title" className={`landing-h2 ${s.display}`}>
            Lo que más nos preguntan.
          </h2>
        </div>
        <div className={s.faq}>
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Contact({ contact }: { contact: SupportContactConfig }) {
  const email = contact.emails[0] ?? null
  return (
    <section id="contacto" className={s.section} style={{ paddingTop: 0 }} aria-labelledby="lv2-contact-title">
      <div className={s.wrap}>
        <div className={s.contactBox}>
          <div className={s.lightField} style={{ top: -700, opacity: 0.7 }} aria-hidden />
          <h2 id="lv2-contact-title" className={`landing-h2 ${s.display}`} style={{ color: '#fff', marginTop: 0 }}>
            Hablemos de tu negocio.
          </h2>
          <p className={s.lead} style={{ color: 'var(--d-muted)' }}>
            Contanos qué vendés y cómo atendés hoy. Te mostramos Betsy con tus propios casos.
          </p>
          <div className={s.contactLinks}>
            {contact.whatsapp && (
              <a className={s.contactLink} href={contact.whatsapp.url} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={20} color="#25d366" aria-hidden /> WhatsApp {contact.whatsapp.display}
              </a>
            )}
            {contact.instagram && (
              <a className={s.contactLink} href={contact.instagram.url} target="_blank" rel="noopener noreferrer">
                <Instagram size={20} color="#f58529" aria-hidden /> Instagram {contact.instagram.display}
              </a>
            )}
            {email && (
              <a className={s.contactLink} href={`mailto:${email}`}>
                <Mail size={20} color="#a9b1ff" aria-hidden /> {email}
              </a>
            )}
            <a className={s.contactLink} href={LINKS.support}>
              <LifeBuoy size={20} color="#a9b1ff" aria-hidden /> Abrí un caso en Soporte
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <footer className={s.footer}>
      <div className={`${s.wrap} ${s.footerInner}`}>
        <p style={{ margin: 0 }}>
          <span className={s.logo} style={{ color: 'var(--ink)', fontSize: 18 }}>
            Betsy
          </span>
          <span style={{ marginLeft: 12 }}>Hecho en Costa Rica · © {new Date().getFullYear()}</span>
        </p>
        <nav aria-label="Legal y ayuda" className={s.footerLinks}>
          <a href={LINKS.support}>Soporte</a>
          <a href={LINKS.docs}>Centro de ayuda</a>
          <a href="/terms">Términos</a>
          <a href="/privacy">Privacidad</a>
        </nav>
      </div>
    </footer>
  )
}
