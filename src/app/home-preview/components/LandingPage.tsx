import Link from 'next/link';
import { ArrowRight, Check, Instagram, Mail, MessageCircle } from 'lucide-react';
import { getSupportContactConfig } from '@/lib/support/contact-config';
import { BETSY_PLAN, planPriceLabels } from '@/lib/pricing/plan';
import { AGENT_PROCESS, AGENTS, FAQ, HERO, INBOX, OPERATIONS, PRICING, PROOF } from '../content';
import { AuthHost, LandingNav, OpenAuthButton } from './LandingIslands';
import { InboxMock, PipelineMock } from './LandingMocks';

/** Public landing. Server-rendered; only the nav and the sign-in modal run on the client. */

const AGENT_CTA_HREF = '/soporte?tema=agente';

// globals-mobile.css shrinks every h1/h2/h3 with !important on phones; `landing-hero` / `landing-h2` opt out of
// that and the !-sizes below win over the h3 rule and the landing-* defaults.
const serif ='font-[family-name:var(--font-home-serif)] !font-normal !tracking-[-0.01em]';
const h2 = `landing-h2 ${serif} !text-[40px] !leading-[1.05] text-[#14131a] sm:!text-[52px]`;
const label = 'text-[12px] font-semibold uppercase tracking-[0.14em] text-[#4048d4]';
const lead = 'text-[17px] leading-relaxed text-[#14131a]/65 sm:text-[18px]';
const primaryBtn =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#14131a] px-6 text-[15px] font-semibold text-white transition hover:bg-[#2a2833] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b6cff]';
const secondaryBtn =
  'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-[#14131a]/15 bg-white/60 px-6 text-[15px] font-semibold text-[#14131a] transition hover:border-[#14131a]/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b6cff]';

function SectionHead({ eyebrow, title, intro, center = false }: { eyebrow: string; title: string; intro?: string; center?: boolean }) {
  return (
    <div className={`max-w-2xl ${center ? 'mx-auto text-center' : ''}`}>
      <p className={label}>{eyebrow}</p>
      <h2 className={`${h2} mt-4`}>{title}</h2>
      {intro && <p className={`${lead} mt-5`}>{intro}</p>}
    </div>
  );
}

export default function LandingPage() {
  const contact = getSupportContactConfig();
  const price = planPriceLabels();
  const email = contact.emails[0] ?? null;

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#14131a] antialiased">
      <LandingNav />

      <main id="inicio">
        {/* Hero */}
        <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-36">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 right-[-20%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(91,108,255,0.18),transparent)] sm:right-[-5%]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-[#14131a]/10 bg-white/70 px-3 py-1 text-[12px] font-medium text-[#14131a]/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#22a06b]" aria-hidden />
                {HERO.eyebrow}
              </p>
              <h1 className={`landing-hero ${serif} mt-6 !text-[48px] !leading-[0.98] sm:!text-[68px] lg:!text-[76px]`}>
                Tus chats, tus pedidos y tus envíos <em className="italic text-[#5b6cff]">en un solo lugar.</em>
              </h1>
              <p className={`${lead} mt-6 max-w-xl`}>{HERO.lead}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <OpenAuthButton className={primaryBtn}>
                  Probar {BETSY_PLAN.trialDays} días gratis <ArrowRight className="h-4 w-4" aria-hidden />
                </OpenAuthButton>
                <Link href={AGENT_CTA_HREF} className={secondaryBtn}>
                  Quiero mi agente de IA
                </Link>
              </div>
              <p className="mt-4 text-[13px] text-[#14131a]/65">
                {price.short} · sin tarjeta para la prueba
              </p>
            </div>
            <InboxMock />
          </div>
        </section>

        {/* Bandeja */}
        <section id="bandeja" className="scroll-mt-20 border-t border-[#14131a]/[0.08] px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <SectionHead eyebrow={INBOX.label} title={INBOX.title} intro={INBOX.lead} />
            <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {INBOX.points.map((p, i) => (
                <div key={p.title} className="border-t border-[#14131a]/15 pt-5">
                  <dt className="flex items-baseline gap-3 text-[16px] font-semibold">
                    <span className={`${serif} text-[22px] text-[#4048d4]`}>{String(i + 1).padStart(2, '0')}</span>
                    {p.title}
                  </dt>
                  <dd className="mt-2 text-[15px] leading-relaxed text-[#14131a]/60">{p.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Operación */}
        <section id="operacion" className="scroll-mt-20 bg-white px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-start gap-14 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <SectionHead eyebrow={OPERATIONS.label} title={OPERATIONS.title} intro={OPERATIONS.lead} />
              <ol className="mt-10 space-y-6">
                {OPERATIONS.steps.map((s, i) => (
                  <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f6f4ef] text-[13px] font-semibold text-[#14131a]/70">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-[16px] font-semibold">{s.title}</p>
                      <p className="mt-1 text-[15px] leading-relaxed text-[#14131a]/60">{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="lg:sticky lg:top-24">
              <PipelineMock />
              <ul className="mt-6 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {OPERATIONS.extras.map((x) => (
                  <li key={x} className="flex items-start gap-2 text-[14px] text-[#14131a]/70">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#22a06b]" aria-hidden />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Agentes */}
        <section id="agentes" className="scroll-mt-20 bg-[#14131a] px-4 py-20 text-white sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a9b1ff]">{AGENTS.label}</p>
              <h2 className={`landing-h2 ${serif} mt-4 !text-[40px] !leading-[1.05] sm:!text-[52px]`}>{AGENTS.title}</h2>
              <p className="mt-5 text-[17px] leading-relaxed text-white/65 sm:text-[18px]">{AGENTS.lead}</p>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-[22px] bg-white/10 sm:grid-cols-2">
              {AGENTS.points.map((p) => (
                <div key={p.title} className="bg-[#14131a] p-6 sm:p-8">
                  <p className="text-[17px] font-semibold">{p.title}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-white/60">{p.text}</p>
                </div>
              ))}
            </div>

            <div className="mt-20">
              <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#a9b1ff]">{AGENT_PROCESS.label}</p>
              <h3 className={`${serif} mt-4 max-w-2xl !text-[34px] !leading-[1.08] sm:!text-[44px]`}>{AGENT_PROCESS.title}</h3>
              <ol className="mt-10 grid gap-6 md:grid-cols-5 md:gap-4">
                {AGENT_PROCESS.steps.map((s, i) => (
                  <li key={s.title} className="relative border-t border-white/20 pt-5">
                    <span className={`${serif} text-[30px] text-[#a9b1ff]`}>{i + 1}</span>
                    <p className="mt-2 text-[16px] font-semibold">{s.title}</p>
                    <p className="mt-2 text-[14px] leading-relaxed text-white/60">{s.text}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href={AGENT_CTA_HREF}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-[#14131a] transition hover:bg-[#eef0ff]"
                >
                  Quiero mi agente <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <p className="text-[13px] text-white/60">Funciona con modelos de OpenAI. Te contactamos para conocer tu negocio.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Lo que hay detrás */}
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <SectionHead eyebrow={PROOF.label} title={PROOF.title} />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PROOF.items.map((p) => (
                <div key={p.title} className="rounded-[20px] border border-[#14131a]/10 bg-white p-6">
                  <p className="text-[16px] font-semibold">{p.title}</p>
                  <p className="mt-2 text-[14px] leading-relaxed text-[#14131a]/60">{p.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Precios */}
        <section id="precios" className="scroll-mt-20 border-t border-[#14131a]/[0.08] bg-white px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <SectionHead eyebrow={PRICING.label} title={PRICING.title} intro={PRICING.lead} center />
            <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">
              <div className="flex flex-col rounded-[24px] border-2 border-[#14131a] p-7 sm:p-8">
                <p className="text-[15px] font-semibold">Betsy</p>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className={`${serif} text-[64px] leading-none`}>{price.base}</span>
                  <span className="text-[15px] text-[#14131a]/60">/mes + IVA</span>
                </p>
                <p className="mt-2 text-[13px] text-[#14131a]/65">
                  {price.base} + IVA {price.ivaPercent} ({price.iva}) = <strong className="font-semibold text-[#14131a]">{price.total} al mes</strong>
                </p>
                <ul className="mt-6 space-y-2.5">
                  {PRICING.planFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[15px] text-[#14131a]/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#22a06b]" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <OpenAuthButton className={`${primaryBtn} w-full`}>Probar {BETSY_PLAN.trialDays} días gratis</OpenAuthButton>
                  <p className="mt-3 text-center text-[12px] text-[#14131a]/65">Sin tarjeta para la prueba. Pagás con tarjeta por Tilopay.</p>
                </div>
              </div>

              <div className="flex flex-col rounded-[24px] bg-[#f6f4ef] p-7 sm:p-8">
                <p className="text-[15px] font-semibold">{PRICING.aiTitle}</p>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className={`${serif} text-[44px] leading-none`}>Según uso</span>
                </p>
                <p className="mt-2 text-[13px] text-[#14131a]/65">{PRICING.aiLead}</p>
                <ul className="mt-6 space-y-2.5">
                  {PRICING.aiFeatures.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[15px] text-[#14131a]/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4048d4]" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <Link href={AGENT_CTA_HREF} className={`${secondaryBtn} w-full bg-white`}>
                    Quiero mi agente
                  </Link>
                  <p className="mt-3 text-center text-[12px] text-[#14131a]/65">Si se acaba el saldo, la IA se pausa y tu equipo sigue atendiendo.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Preguntas */}
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHead eyebrow="Preguntas" title="Lo que más nos preguntan." />
            <div className="divide-y divide-[#14131a]/10 border-y border-[#14131a]/10">
              {FAQ.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden className="text-[22px] font-light text-[#14131a]/65 transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-[#14131a]/65">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Contacto */}
        <section id="contacto" className="scroll-mt-20 px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="mx-auto max-w-6xl rounded-[28px] bg-[#14131a] px-6 py-14 text-white sm:px-12 sm:py-16">
            <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
              <div>
                <h2 className={`landing-h2 ${serif} !text-[40px] !leading-[1.05] sm:!text-[52px]`}>Hablemos de tu negocio.</h2>
                <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-white/65">
                  Contanos qué vendés y cómo atendés hoy. Te mostramos Betsy con tus propios casos.
                </p>
              </div>
              <ul className="grid gap-3">
                {contact.whatsapp && (
                  <li>
                    <a href={contact.whatsapp.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 transition hover:bg-white/[0.12]">
                      <MessageCircle className="h-5 w-5 text-[#25d366]" aria-hidden />
                      <span className="text-[15px]">WhatsApp {contact.whatsapp.display}</span>
                    </a>
                  </li>
                )}
                {contact.instagram && (
                  <li>
                    <a href={contact.instagram.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 transition hover:bg-white/[0.12]">
                      <Instagram className="h-5 w-5 text-[#f58529]" aria-hidden />
                      <span className="text-[15px]">Instagram {contact.instagram.display}</span>
                    </a>
                  </li>
                )}
                {email && (
                  <li>
                    <a href={`mailto:${email}`} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 transition hover:bg-white/[0.12]">
                      <Mail className="h-5 w-5 text-[#a9b1ff]" aria-hidden />
                      <span className="text-[15px]">{email}</span>
                    </a>
                  </li>
                )}
                <li>
                  <Link href="/soporte" className="block px-4 pt-1 text-[14px] text-white/60 underline-offset-4 hover:text-white hover:underline">
                    O abrí un caso en Soporte →
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#14131a]/10 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 text-[13px] text-[#14131a]/65 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-[family-name:var(--font-logo)] text-[16px] font-bold text-[#14131a]">Betsy</span>
            <span className="ml-3">Hecho en Costa Rica · © {new Date().getFullYear()}</span>
          </p>
          <nav aria-label="Legal y ayuda" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/soporte" className="hover:text-[#14131a]">Soporte</Link>
            <Link href="/docs" className="hover:text-[#14131a]">Centro de ayuda</Link>
            <Link href="/terms" className="hover:text-[#14131a]">Términos</Link>
            <Link href="/privacy" className="hover:text-[#14131a]">Privacidad</Link>
          </nav>
        </div>
      </footer>

      <AuthHost />
    </div>
  );
}
