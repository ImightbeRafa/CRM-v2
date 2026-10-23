import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Instagram, LifeBuoy, Mail, MessageCircle } from 'lucide-react';
import { getSupportContactConfig } from '@/lib/support/contact-config';
import { supportPipelineEnabled } from '@/lib/support/config';
import { SoporteClient } from './SoporteClient';
import { BetsyLogo } from '@/components/brand/BetsyLogo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Soporte y contacto · Betsy',
  description: 'Escribinos por WhatsApp, Instagram o correo, o abrí un caso de soporte.',
};

/** Public support / contact page (SPEC §7.1). Contact info from env; empty values are hidden. */
export default async function SoportePage({ searchParams }: { searchParams: Promise<{ tema?: string | string[] }> }) {
  const { tema } = await searchParams;
  const topic = tema === 'agente' ? 'agent' : null;
  const contact = getSupportContactConfig();
  const ticketsEnabled = supportPipelineEnabled();

  return (
    <div className="aurora-light min-h-screen bg-[var(--aurora-canvas,#f7f7fb)] text-slate-900">
      <header className="border-b border-slate-200/70 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <BetsyLogo tone="light" size={20} href="/home" ariaLabel="Betsy, inicio" />
          <Link href="/help" className="text-[13px] font-medium text-slate-500 hover:text-slate-800">
            Centro de ayuda
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white">
            <LifeBuoy className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold">Soporte y contacto</h1>
            <p className="max-w-xl text-[14px] text-slate-500">
              Escribinos por donde te quede más cómodo. Si abrís un caso, te damos un número para darle seguimiento.
            </p>
          </div>
        </div>

        <section aria-label="Canales de contacto" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {contact.whatsapp && (
            <a
              href={contact.whatsapp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-emerald-300 hover:shadow-md"
            >
              <MessageCircle className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-500">WhatsApp</span>
                <span className="block truncate text-[14px] font-medium">{contact.whatsapp.display}</span>
              </span>
            </a>
          )}
          {contact.instagram && (
            <a
              href={contact.instagram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-pink-300 hover:shadow-md"
            >
              <Instagram className="h-5 w-5 shrink-0 text-pink-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-500">Instagram</span>
                <span className="block truncate text-[14px] font-medium">{contact.instagram.display}</span>
              </span>
            </a>
          )}
          {contact.emails.map((email) => (
            <a
              key={email}
              href={`mailto:${email}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-indigo-300 hover:shadow-md"
            >
              <Mail className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-500">Correo</span>
                <span className="block truncate text-[14px] font-medium">{email}</span>
              </span>
            </a>
          ))}
          {contact.hours && (
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
              <Clock className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
              <span className="min-w-0">
                <span className="block text-[12px] text-slate-500">Horario</span>
                <span className="block text-[14px] font-medium">{contact.hours}</span>
              </span>
            </div>
          )}
        </section>

        <SoporteClient ticketsEnabled={ticketsEnabled} topic={topic} />
      </main>
    </div>
  );
}
