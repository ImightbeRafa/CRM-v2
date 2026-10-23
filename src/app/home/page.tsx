import type { Metadata } from 'next'
import { Instrument_Serif } from 'next/font/google'
import { LandingV2 } from '@/components/landing-v2/LandingV2'

const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-home-serif',
  // swap: the brand serif always shows; next/font's size-adjusted fallback keeps the headline's box (CLS 0).
  display: 'swap',
})

/** Public home (Rafael approved the v2 landing on 2026-10-23; it replaced the Release 1 landing). */
export const metadata: Metadata = {
  title: 'Betsy · Chats, pedidos y envíos en un solo lugar',
  description:
    'Betsy junta WhatsApp e Instagram en una bandeja, convierte cada chat en un pedido y lo sigue hasta la entrega con Correos de Costa Rica. Agentes de IA hechos para tu negocio.',
  alternates: { canonical: '/home' },
  openGraph: {
    title: 'Betsy · Chats, pedidos y envíos en un solo lugar',
    description: 'WhatsApp e Instagram en una bandeja, pedidos hasta la entrega y agentes de IA hechos a la medida. Hecho en Costa Rica.',
    type: 'website',
    locale: 'es_CR',
    siteName: 'Betsy',
  },
}

// Static, refreshed hourly so contact details from env follow the container's values.
export const revalidate = 3600

export default function Landing() {
  // The landing keeps its own look in any theme.
  return (
    <div className={`theme-static ${serif.variable}`} lang="es-CR">
      <LandingV2 />
    </div>
  )
}
