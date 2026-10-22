import type { Metadata } from 'next';
import { Instrument_Serif } from 'next/font/google';
import LandingPage from './components/LandingPage';
import { planPriceLabels } from '@/lib/pricing/plan';

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-home-serif',
  display: 'swap',
});

const price = planPriceLabels();

export const metadata: Metadata = {
  title: 'Betsy · Chats, pedidos y envíos en un solo lugar',
  description: `Bandeja de WhatsApp e Instagram, pedidos, producción y envíos con Correos de Costa Rica, y agentes de IA hechos para tu negocio. ${price.short}.`,
  alternates: { canonical: '/home' },
  // Work-in-progress redesign (Lane H): reachable only by link, never indexed, not in any nav.
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Betsy · Chats, pedidos y envíos en un solo lugar',
    description: 'WhatsApp e Instagram en una bandeja, pedidos hasta la entrega y agentes de IA hechos a la medida. Hecho en Costa Rica.',
    type: 'website',
    locale: 'es_CR',
    siteName: 'Betsy',
  },
};

// Static, refreshed hourly so contact details from env (getSupportContactConfig) follow the container's values.
export const revalidate = 3600;

export default function Landing() {
  // The landing keeps its own look in any theme.
  return (
    <div className={`theme-static ${serif.variable}`} lang="es-CR">
      <LandingPage />
    </div>
  );
}
