import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock, Instagram, Mail, MessageCircle, Sparkles, Ticket } from 'lucide-react';
import { getSupportContactConfig } from '@/lib/support/contact-config';
import { supportPipelineEnabled } from '@/lib/support/config';
import { SoporteClient } from './SoporteClient';
import { BetsyLogo } from '@/components/brand/BetsyLogo';
import { NightSky } from '@/components/sky/NightSky';
import s from './soporte.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Soporte y contacto · Betsy',
  description: 'Escribinos por WhatsApp, Instagram o correo, o abrí un caso de soporte.',
  openGraph: { images: [{ url: '/brand/betsy/og-cream-1200x630.png', width: 1200, height: 630, alt: 'Betsy' }] },
};

/**
 * Public support / contact page (SPEC §7.1). Contact info from env; empty values are hidden.
 * Look (Rafael 2026-10-23): the home's night-sky band on top, the form with Betsy listening next to it, and a side
 * panel with the other channels, what happens after you write, and the agent CTA. Light in any app theme.
 */
export default async function SoportePage({ searchParams }: { searchParams: Promise<{ tema?: string | string[] }> }) {
  const { tema } = await searchParams;
  const topic = tema === 'agente' ? 'agent' : null;
  const contact = getSupportContactConfig();
  const ticketsEnabled = supportPipelineEnabled();

  return (
    <div className={`theme-light ${s.page}`}>
      <header className={s.band}>
        <NightSky seed={11} bottom="canvas" stars={40} constellation={{ x: 76, y: 22, w: 120 }} />
        <div className={s.bar}>
          <BetsyLogo size={21} href="/home" ariaLabel="Betsy, inicio" />
          <nav aria-label="Soporte" className={s.barLinks}>
            <Link href="/help">Centro de ayuda</Link>
            <Link href="/auth/signin" className={s.barSignin}>
              Iniciar sesión
            </Link>
          </nav>
        </div>
        <div className={s.intro}>
          <p className={s.eyebrow}>Soporte y contacto</p>
          <h1 className={s.title}>¿En qué te ayudamos?</h1>
          <p className={s.lead}>
            Escribinos por donde te quede más cómodo. Si abrís un caso, te damos un número para darle seguimiento.
          </p>
        </div>
      </header>

      <main className={s.main}>
        <div className={s.grid}>
          <div className={s.formCol}>
            <SoporteClient ticketsEnabled={ticketsEnabled} topic={topic} />
          </div>

          <aside className={s.side} aria-label="Más formas de contacto">
            {(contact.whatsapp || contact.instagram || contact.emails.length > 0 || contact.hours) && (
              <section className={s.card}>
                <h2 className={s.cardTitle}>Otras formas de escribirnos</h2>
                <div className={s.channels}>
                  {contact.whatsapp && (
                    <a
                      href={contact.whatsapp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={s.channel}
                      data-kind="wa"
                    >
                      <span className={s.channelIcon}>
                        <MessageCircle aria-hidden />
                      </span>
                      <span className={s.channelText}>
                        <span>WhatsApp</span>
                        <b>{contact.whatsapp.display}</b>
                      </span>
                      <ArrowRight className={s.channelGo} aria-hidden />
                    </a>
                  )}
                  {contact.instagram && (
                    <a
                      href={contact.instagram.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={s.channel}
                      data-kind="ig"
                    >
                      <span className={s.channelIcon}>
                        <Instagram aria-hidden />
                      </span>
                      <span className={s.channelText}>
                        <span>Instagram</span>
                        <b>{contact.instagram.display}</b>
                      </span>
                      <ArrowRight className={s.channelGo} aria-hidden />
                    </a>
                  )}
                  {contact.emails.map((email) => (
                    <a key={email} href={`mailto:${email}`} className={s.channel} data-kind="mail">
                      <span className={s.channelIcon}>
                        <Mail aria-hidden />
                      </span>
                      <span className={s.channelText}>
                        <span>Correo</span>
                        <b>{email}</b>
                      </span>
                      <ArrowRight className={s.channelGo} aria-hidden />
                    </a>
                  ))}
                </div>
                {contact.hours && (
                  <p className={s.hours}>
                    <Clock aria-hidden /> Horario: {contact.hours}
                  </p>
                )}
              </section>
            )}

            <section className={s.card}>
              <h2 className={s.cardTitle}>Qué pasa cuando nos escribís</h2>
              <ol className={s.steps}>
                <li>
                  <Ticket aria-hidden />
                  <span>Si abrís un caso, te damos un número para darle seguimiento.</span>
                </li>
                <li>
                  <Mail aria-hidden />
                  <span>Te respondemos por correo lo antes posible{contact.hours ? ', en nuestro horario' : ''}.</span>
                </li>
                <li>
                  <BookOpen aria-hidden />
                  <span>
                    ¿Ya usás Betsy? En el <Link href="/help">Centro de ayuda</Link> hay guías paso a paso (con tu
                    cuenta).
                  </span>
                </li>
              </ol>
            </section>

            {topic !== 'agent' && (
              <a href="/soporte?tema=agente" className={s.agentCta}>
                <Sparkles aria-hidden />
                <span>
                  <b>Quiero mi agente de IA</b>
                  <span>Contanos qué vendés y te armamos un agente con tu información.</span>
                </span>
                <ArrowRight className={s.channelGo} aria-hidden />
              </a>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
